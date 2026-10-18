import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as LucideIconsIndex from 'lucide-react'
import { supabase, rupee, rupeeFull, dateFmt } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTabVisibility } from '../context/TabVisibilityContext'
import { useWorkspace } from '../context/WorkspaceContext'
import {
  listIndustryProfiles, listBusinessTypes, listOperatingModels,
  updateWorkspaceProfile, listWorkspaceOperatingModels, setWorkspaceOperatingModels, isModuleInWorkspace,
} from '../lib/workspace'
import { recommendModuleKeys } from '../lib/workspaceRecommendation'
import { DASHBOARD_WIDGETS } from '../lib/workspaceDashboardWidgets'
import { listAllWorkTypeConfigs, createWorkTypeConfig, updateWorkTypeConfig } from '../lib/workItems'
import { listTaskTemplates, createTaskTemplate, updateTaskTemplate, deleteTaskTemplate, CHECKLIST_TYPES } from '../lib/taskTemplates'
import { TASK_FIELD_CATALOG, listTaskFieldRules, fieldRulesToMap, saveTaskFieldRules } from '../lib/taskFieldRules'
import { getTaskDetailViewStyle, setTaskDetailViewStyle } from '../lib/taskViewSettings'
import { listFlows, ensureFlow, saveFlowSteps, distinctStatusesInUse, remapTaskStatuses } from '../lib/departmentStatusFlows'
import { listRoles, createRole, updateRole, deleteRole, colorForRole } from '../lib/roles'
import { getModules, setModuleEnabled, getModuleRoleVisibility, setModuleRoleVisibility, setModuleRoleVisibilityBulk } from '../lib/modules'
import { getLLMSettings, saveLLMSettings } from '../lib/llmSettings'
import { getDocumentSettings, saveDocumentSettings } from '../lib/documentSettings'
import { listTemplates, createTemplate, updateTemplate, setActive, archiveTemplate, deleteTemplate } from '../lib/documentTemplates'
import {
  PROPOSAL_CATEGORIES, listAllProposalCategories, getBudgetCategoryMap,
  upsertBudgetCategoryMapping, deleteBudgetCategoryMapping, listBudgetCategories, addBudgetCategory,
} from '../lib/proposals'
import { MODULES, MODULE_SECTIONS } from '../config/modules'
import { Alert, Modal, Confirm, Loader, Empty, SearchBox, Toggle } from '../components/ui'
import {
  Settings, GitBranch, DollarSign, Bell, Tag, FileText, Sparkles, TrendingUp, Megaphone,
  Save, Plus, Trash2, Edit2, Check, X, Users, Eye, EyeOff, Shield, ChevronDown, ChevronRight, ChevronUp, Building2,
  CreditCard, Clock, CheckCircle2, LayoutTemplate, ArrowUp, ArrowDown, Puzzle, Lock, Unlock, Key, Smartphone, Compass, MapPin,
  Layers, ClipboardList, Sliders, ListChecks, Mail, MailCheck,
} from 'lucide-react'
import { listInvites, createInvite, revokeInvite } from '../lib/orgInvites'
import EmailSettingsTab from '../components/settings/EmailSettingsTab'
import OutlookSettings from '../components/outlook/OutlookSettings'
import EmailIntelligenceSettings from '../components/ei/EmailIntelligenceSettings'
import { sendInviteEmail, isValidEmail } from '../lib/email'
import { listDepartments, createDepartment, updateDepartment, deleteDepartment } from '../lib/onboarding'
import { listLocations, createLocation, updateLocation, deleteLocation } from '../lib/locations'
import { listTeams, createTeam, updateTeam, deleteTeam, addTeamMember, removeTeamMember } from '../lib/teams'
import { listShiftPatterns, createShiftPattern, listShiftAssignments, assignShift } from '../lib/shifts'
import {
  listAllSlides, createSlide, updateSlide, deleteSlide, reorderSlide,
  listAllTourSteps, createTourStep, updateTourStep, deleteTourStep, reorderTourStep,
} from '../lib/appWalkthrough'
import { WEB_TOUR_TARGETS } from '../lib/appTourTargets'
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
import {
  getMobileCapableKeys, getMobileModuleConfig, setMobileModuleConfig,
  getAllocationEnforcement, previewAllocationImpact, backfillAllocations, setAllocationEnforcement,
  effectiveModulesFor, REASON_LABEL as MOBILE_REASON_LABEL,
} from '../lib/mobileApp'

// ── Roles & Modules (Admin Feature) ──
// Company-wide module enablement (a real kill switch, applies to every
// role including admin/ceo) plus per-role visibility within enabled
// modules — both Supabase-backed via src/lib/modules.js, and role
// management via src/lib/roles.js (STEP42's dynamic roles table).
function RolesModulesTab() {
  const { profile } = useAuth()
  const { refresh } = useTabVisibility()
  const navigate = useNavigate()
  const [roles, setRoles] = useState([])
  const [modules, setModulesState] = useState([])
  const [visibility, setVisibility] = useState([])
  const [loading, setLoading] = useState(true)
  const [openSections, setOpenSections] = useState(() => new Set([MODULE_SECTIONS[0]]))
  const [modQuery, setModQuery] = useState('')

  // Cost calculator — reuses STEP124's per-seat bundle prices. A module's
  // price is its parent bundle's monthly per-seat price split evenly
  // across every module in that bundle; modules in no bundle are free.
  const [bundles, setBundles] = useState([])
  const [activeBundleKeys, setActiveBundleKeys] = useState(new Set())
  const [seatCount, setSeatCount] = useState(0)
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingMsg, setBillingMsg] = useState('')

  const [selectedMods, setSelectedMods] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  // "Manage Access" modal — pick every module a single role can see in one
  // pass (checkboxes, no network call per click) and persist the whole
  // picklist in one bulk upsert on Save, instead of the per-cell chip
  // toggle's one-write-per-click.
  const [accessRole, setAccessRole] = useState(null)
  const [accessDraft, setAccessDraft] = useState({})
  const [accessQuery, setAccessQuery] = useState('')
  const [savingAccess, setSavingAccess] = useState(false)

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
    const [r, m, v, b, subs, seats] = await Promise.all([
      listRoles(),
      getModules(profile.organization_id),
      getModuleRoleVisibility(profile.organization_id),
      listBundles().catch(() => []),
      myBundleSubscriptions(profile.organization_id).catch(() => []),
      supabase.from('profiles').select('id', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id).eq('is_active', true),
    ])
    setRoles(r); setModulesState(m); setVisibility(v)
    setBundles(b); setActiveBundleKeys(new Set(subs.map(s => s.bundle_key)))
    setSeatCount(seats.count ?? 0)
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

  // Sections + per-section module list, filtered by the search box. A
  // module missing from the DB table is treated as enabled (matches
  // isTabVisible()'s "default visible unless a row says otherwise").
  const sectionsData = useMemo(() => {
    const q = modQuery.trim().toLowerCase()
    return MODULE_SECTIONS.map(section => {
      const mods = MODULES.filter(m => m.section === section)
      const shown = q
        ? mods.filter(m => m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q))
        : mods
      const onCount = mods.filter(m => (moduleByKey[m.key]?.enabled ?? true)).length
      return { section, mods, shown, onCount }
    }).filter(s => s.shown.length > 0)
  }, [moduleByKey, modQuery])
  const totalMods = MODULES.length
  const totalOn = useMemo(
    () => MODULES.filter(m => (moduleByKey[m.key]?.enabled ?? true)).length,
    [moduleByKey],
  )

  // ── Cost calculator ──
  const isEnterprise = profile?.org?.plan_key === 'enterprise'
  // {moduleKey: {bundleKey, bundleName, unitMonthly}} — bundle price / module count.
  const priceByModule = useMemo(() => {
    const map = {}
    bundles.forEach(b => {
      const keys = b.module_keys || []
      if (!keys.length) return
      const unit = Number(b.price_per_seat_monthly || 0) / keys.length
      keys.forEach(k => { map[k] = { bundleKey: b.key, bundleName: b.name, unitMonthly: unit } })
    })
    return map
  }, [bundles])
  const enabledSet = useMemo(
    () => new Set(MODULES.filter(m => (moduleByKey[m.key]?.enabled ?? true)).map(m => m.key)),
    [moduleByKey],
  )
  const estPerSeatMonthly = useMemo(
    () => [...enabledSet].reduce((s, k) => s + (priceByModule[k]?.unitMonthly || 0), 0),
    [enabledSet, priceByModule],
  )
  const estTotalMonthly = estPerSeatMonthly * (seatCount || 0)
  const sectionSeatCost = section =>
    MODULES.filter(m => m.section === section && enabledSet.has(m.key))
      .reduce((s, m) => s + (priceByModule[m.key]?.unitMonthly || 0), 0)

  // Bundles the current enable-selection implies but the org hasn't
  // subscribed to (needs activation), and subscribed bundles that no
  // longer have a single enabled module (candidates for deactivation).
  const neededBundles = useMemo(
    () => bundles.filter(b => !isEnterprise && !activeBundleKeys.has(b.key) && (b.module_keys || []).some(k => enabledSet.has(k))),
    [bundles, activeBundleKeys, enabledSet, isEnterprise],
  )
  const staleBundles = useMemo(
    () => bundles.filter(b => activeBundleKeys.has(b.key) && !(b.module_keys || []).some(k => enabledSet.has(k))),
    [bundles, activeBundleKeys, enabledSet],
  )

  async function requestBillingUpdate() {
    setBillingBusy(true); setBillingMsg('')
    const out = []
    for (const b of neededBundles) {
      try { await requestBundleChange(b.key, 'activate', 'Requested from Module Enablement'); out.push(`✓ ${b.name} — activation requested`) }
      catch (e) { out.push(`⚠ ${b.name} — ${e.message}`) }
    }
    for (const b of staleBundles) {
      try { await requestBundleChange(b.key, 'deactivate', 'Requested from Module Enablement'); out.push(`✓ ${b.name} — deactivation requested`) }
      catch (e) { out.push(`⚠ ${b.name} — ${e.message}`) }
    }
    setBillingMsg(out.join('\n'))
    setBillingBusy(false)
    load()
  }

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

  function toggleSection(section) {
    setOpenSections(prev => {
      const next = new Set(prev)
      next.has(section) ? next.delete(section) : next.add(section)
      return next
    })
  }

  // Bulk enable/disable every module in a section (skips the protected
  // 'settings' module). Writes sequentially — a section is a dozen rows
  // at most — then patches local state in one pass and refreshes the nav.
  async function setSectionEnabled(section, enabled) {
    const targets = MODULES.filter(m => m.section === section && m.key !== 'settings')
    try {
      for (const t of targets) {
        if ((moduleByKey[t.key]?.enabled ?? true) === enabled) continue
        await setModuleEnabled(t.key, enabled, profile.id, profile.organization_id)
      }
      const keys = new Set(targets.map(t => t.key))
      setModulesState(prev => prev.map(m => (keys.has(m.key) ? { ...m, enabled } : m)))
      refresh()
    } catch (e) { alert(e.message) }
  }

  function toggleModSelected(key) {
    setSelectedMods(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }
  function clearModSelection() { setSelectedMods(new Set()) }

  // Free-form multi-select bulk enable/disable — unlike setSectionEnabled
  // above (a whole section at once), this applies to whatever mix of
  // individual modules the admin has checked, across any number of
  // sections. Same sequential-write + single local-state-patch pattern.
  async function applyBulkEnabled(enabled) {
    const targets = [...selectedMods].filter(k => k !== 'settings')
    setBulkBusy(true)
    try {
      for (const key of targets) {
        if ((moduleByKey[key]?.enabled ?? true) === enabled) continue
        await setModuleEnabled(key, enabled, profile.id, profile.organization_id)
      }
      setModulesState(prev => prev.map(m => (selectedMods.has(m.key) ? { ...m, enabled } : m)))
      clearModSelection()
      refresh()
    } catch (e) { alert(e.message) }
    finally { setBulkBusy(false) }
  }

  function openAccessModal(role) {
    const draft = {}
    MODULES.forEach(m => { draft[m.key] = visMap[m.key]?.[role.role_key] !== false })
    setAccessDraft(draft); setAccessQuery(''); setAccessRole(role)
  }

  async function saveAccess() {
    if (!accessRole) return
    setSavingAccess(true)
    try {
      const rows = MODULES.map(m => ({ module_key: m.key, visible: accessDraft[m.key] !== false }))
      await setModuleRoleVisibilityBulk(profile.organization_id, accessRole.role_key, rows)
      setVisibility(prev => {
        const others = prev.filter(v => v.role !== accessRole.role_key)
        return [...others, ...rows.map(r => ({ organization_id: profile.organization_id, module_key: r.module_key, role: accessRole.role_key, visible: r.visible }))]
      })
      setAccessRole(null)
      refresh()
    } catch (e) { alert(e.message) }
    finally { setSavingAccess(false) }
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
                {!['admin', 'ceo'].includes(r.role_key) && (
                  <button className="btn btn-ghost btn-sm btn-icon" style={{ width: 22, height: 22, minHeight: 0 }} title="Manage which modules this role can access" onClick={() => openAccessModal(r)}><Sliders size={11} /></button>
                )}
                <button className="btn btn-ghost btn-sm btn-icon" style={{ width: 22, height: 22, minHeight: 0 }} onClick={() => openEditRole(r)}><Edit2 size={11} /></button>
                {!r.is_system && <button className="btn btn-ghost btn-sm btn-icon" style={{ width: 22, height: 22, minHeight: 0, color: '#ef4444' }} onClick={() => { setDeleteErr(''); setDeleteConfirm(r) }}><Trash2 size={11} /></button>}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Module Enablement ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div>
            <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Module Enablement</h3>
            <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', maxWidth: 640 }}>
              "Enabled" is a company-wide kill switch — off means off for everyone, including Admin/CEO. The role chips control nav/page visibility within an enabled module; Admin/CEO always see enabled modules regardless.
            </p>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 999, padding: '5px 12px', whiteSpace: 'nowrap' }}>
            {totalOn} / {totalMods} enabled
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ maxWidth: 320, flex: '1 1 260px' }}>
            <SearchBox value={modQuery} onChange={setModQuery} placeholder="Search modules..." />
          </div>
          {selectedMods.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 10px', borderRadius: 10, background: 'var(--surface-2, rgba(99,102,241,.06))', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{selectedMods.size} selected</span>
              <button className="btn btn-primary btn-sm" disabled={bulkBusy} onClick={() => applyBulkEnabled(true)}>Enable</button>
              <button className="btn btn-outline btn-sm" disabled={bulkBusy} onClick={() => applyBulkEnabled(false)}>Disable</button>
              <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={clearModSelection}>Clear</button>
            </div>
          )}
        </div>

        {/* Cost estimate — per-seat bundle price split across each bundle's modules */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 14px', marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2, rgba(99,102,241,.06))', border: '1px solid var(--border)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
            <DollarSign size={15} style={{ color: 'var(--c1)' }} /> Estimated cost
          </span>
          {isEnterprise ? (
            <span style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>Enterprise plan — every module included.</span>
          ) : (
            <>
              <span style={{ fontWeight: 800, fontSize: 14 }}>
                {rupeeFull(estPerSeatMonthly)}<span style={{ fontWeight: 600, fontSize: 11.5, color: 'var(--ink-muted)' }}> /seat/mo</span>
              </span>
              <span style={{ color: 'var(--ink-muted)' }}>·</span>
              <span style={{ fontWeight: 800, fontSize: 14 }}>
                {rupee(estTotalMonthly)}<span style={{ fontWeight: 600, fontSize: 11.5, color: 'var(--ink-muted)' }}> /mo · {seatCount} active seat{seatCount === 1 ? '' : 's'}</span>
              </span>
              <span style={{ flexBasis: '100%', fontSize: 11, color: 'var(--ink-muted)' }}>Each add-on bundle's per-seat price is split evenly across its modules; modules in no bundle are free. Billing activates whole bundles, so the actual invoice charges a bundle's full price once any of its modules is on.</span>
            </>
          )}
        </div>

        {!isEnterprise && (neededBundles.length > 0 || staleBundles.length > 0) && (
          <div style={{ marginBottom: 14 }}>
            <Alert type="warning" message={
              'This selection ' +
              (neededBundles.length ? `needs ${neededBundles.map(b => b.name).join(', ')} activated` : '') +
              (neededBundles.length && staleBundles.length ? '; ' : '') +
              (staleBundles.length ? `${staleBundles.map(b => b.name).join(', ')} has no enabled module left` : '') +
              '. Billing changes are actioned by the platform team.'
            } />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" disabled={billingBusy} onClick={requestBillingUpdate}>
                {billingBusy ? 'Requesting…' : 'Request billing update'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings?tab=billing')}>Manage in Billing</button>
            </div>
            {billingMsg && <pre style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-muted)', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{billingMsg}</pre>}
          </div>
        )}

        {sectionsData.length === 0 ? (
          <Empty icon={<Puzzle size={40} />} title="No modules match" desc={`Nothing matches "${modQuery.trim()}".`} />
        ) : (
          <div>
            {sectionsData.map(({ section, mods, shown, onCount }) => {
              const isOpen = modQuery.trim() ? true : openSections.has(section)
              return (
                <div key={section} className="mod-section">
                  <div className="mod-section-head">
                    <button type="button" onClick={() => toggleSection(section)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, background: 'none', border: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                      {isOpen ? <ChevronDown size={14} className="mod-caret" /> : <ChevronRight size={14} className="mod-caret" />}
                      <span className="mod-section-name">{section}</span>
                      <span className="mod-section-count">{onCount}/{mods.length} on</span>
                      {!isEnterprise && sectionSeatCost(section) > 0 && (
                        <span className="mod-section-count" style={{ color: 'var(--c1)', borderColor: 'var(--c1)' }}>
                          {rupeeFull(sectionSeatCost(section))}/seat/mo
                        </span>
                      )}
                    </button>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--ink-muted)', fontWeight: 600, cursor: 'pointer', marginRight: 4 }}>
                        <input type="checkbox"
                          checked={shown.filter(m => m.key !== 'settings').every(m => selectedMods.has(m.key)) && shown.some(m => m.key !== 'settings')}
                          onChange={e => {
                            const keys = shown.filter(m => m.key !== 'settings').map(m => m.key)
                            setSelectedMods(prev => {
                              const next = new Set(prev)
                              keys.forEach(k => (e.target.checked ? next.add(k) : next.delete(k)))
                              return next
                            })
                          }}
                          style={{ accentColor: 'var(--c1)', width: 14, height: 14, cursor: 'pointer' }}/>
                        Select
                      </label>
                      <button className="btn btn-ghost btn-sm" disabled={onCount === mods.length} onClick={() => setSectionEnabled(section, true)}>Enable all</button>
                      <button className="btn btn-ghost btn-sm" disabled={onCount === 0} onClick={() => setSectionEnabled(section, false)}>Disable all</button>
                    </div>
                  </div>
                  {isOpen && shown.map(sm => {
                    const mod = moduleByKey[sm.key] || { key: sm.key, label: sm.label, enabled: true }
                    const isProtected = sm.key === 'settings'
                    return (
                      <div key={sm.key} className="mod-row" style={{ opacity: mod.enabled ? 1 : 0.6 }}>
                        <div className="mod-row-main">
                          {!isProtected && (
                            <input type="checkbox" checked={selectedMods.has(sm.key)} onChange={() => toggleModSelected(sm.key)}
                              style={{ accentColor: 'var(--c1)', width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }}/>
                          )}
                          <Toggle checked={mod.enabled} disabled={isProtected}
                            onChange={() => toggleEnabled(mod)} label={mod.enabled ? 'Enabled' : 'Disabled'} />
                          <div style={{ minWidth: 0 }}>
                            <div className="mod-row-label">
                              {sm.label}
                              {isProtected && <Lock size={11} style={{ marginLeft: 6, opacity: 0.5, verticalAlign: '-1px' }} />}
                            </div>
                            <div className="mod-row-key">
                              {sm.key}
                              {!isEnterprise && (
                                <span style={{ marginLeft: 8, color: priceByModule[sm.key] ? 'var(--c1)' : 'var(--ink-muted)', fontFamily: 'inherit', fontWeight: 700 }}>
                                  {priceByModule[sm.key]
                                    ? `${rupeeFull(priceByModule[sm.key].unitMonthly)}/seat/mo`
                                    : 'Free'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mod-roles">
                          {!mod.enabled ? (
                            <span style={{ fontSize: 11.5, color: 'var(--ink-muted)', fontWeight: 600 }}>Disabled company-wide</span>
                          ) : gridRoles.length === 0 ? (
                            <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Visible to everyone</span>
                          ) : gridRoles.map(r => {
                            const vis = visMap[sm.key]?.[r.role_key] !== false
                            return (
                              <button key={r.role_key} type="button"
                                className={`chip-toggle ${vis ? 'on' : ''}`}
                                title={vis ? `${r.label} can see this` : `Hidden from ${r.label}`}
                                onClick={() => toggleVisible(sm.key, r.role_key)}>
                                {vis ? <Eye size={11} /> : <EyeOff size={11} />} {r.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Manage Access modal — pick every module a role can see, save once ── */}
      <Modal open={!!accessRole} onClose={() => setAccessRole(null)} title={accessRole ? `Manage Access — ${accessRole.label}` : ''} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setAccessRole(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveAccess} disabled={savingAccess}>
            <Save size={13} /> {savingAccess ? 'Saving...' : 'Save'}
          </button>
        </>}>
        {accessRole && (() => {
          const q = accessQuery.trim().toLowerCase()
          const visibleMods = q ? MODULES.filter(m => m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q)) : MODULES
          const onCount = Object.values(accessDraft).filter(Boolean).length
          return (
            <div>
              <p style={{ color: 'var(--ink-muted)', fontSize: '0.85rem', marginBottom: 12 }}>
                Check every module {accessRole.label} should be able to see in the sidebar. This only affects visibility for this role — it doesn't turn a module off company-wide.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <div style={{ maxWidth: 280, flex: '1 1 220px' }}>
                  <SearchBox value={accessQuery} onChange={setAccessQuery} placeholder="Search modules..." />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)' }}>{onCount} / {MODULES.length} selected</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setAccessDraft(Object.fromEntries(MODULES.map(m => [m.key, true])))}>Select all</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setAccessDraft(Object.fromEntries(MODULES.map(m => [m.key, false])))}>Select none</button>
              </div>
              <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                {MODULE_SECTIONS.map(section => {
                  const mods = visibleMods.filter(m => m.section === section)
                  if (mods.length === 0) return null
                  return (
                    <div key={section}>
                      <div style={{ padding: '7px 12px', background: 'var(--surface-2, rgba(99,102,241,.06))', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--border)' }}>{section}</div>
                      {mods.map(m => (
                        <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
                          <input type="checkbox" checked={accessDraft[m.key] !== false}
                            onChange={e => setAccessDraft(prev => ({ ...prev, [m.key]: e.target.checked }))}
                            style={{ accentColor: 'var(--c1)', width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }}/>
                          <span style={{ minWidth: 0 }}>{m.label} <span style={{ fontSize: 10.5, color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)' }}>{m.key}</span></span>
                        </label>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}
      </Modal>

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

// ── Departments ──
function DepartmentsTab() {
  const { profile } = useAuth()
  const [depts, setDepts] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', code: '' })
  const [editing, setEditing] = useState(null)
  const [editVal, setEditVal] = useState({ name: '', code: '' })
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try { setDepts(await listDepartments(profile.organization_id)) } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  async function handleAdd() {
    if (!form.name.trim()) return
    setErr('')
    try { await createDepartment(profile.organization_id, form.name.trim(), form.code.trim() || null); setForm({ name: '', code: '' }); await load() }
    catch (e) { setErr(e.message) }
  }
  function startEdit(d) { setEditing(d.id); setEditVal({ name: d.name, code: d.code || '' }) }
  async function handleSaveEdit(id) {
    if (!editVal.name.trim()) return
    setErr('')
    try { await updateDepartment(id, editVal.name.trim(), editVal.code.trim() || null); setEditing(null); await load() }
    catch (e) { setErr(e.message) }
  }
  async function confirmDelete() {
    try { await deleteDepartment(deleteConfirm.id); setDeleteConfirm(null); await load() }
    catch (e) { setErr(e.message); setDeleteConfirm(null) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Departments</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>Add, rename or remove departments in your organization.</p>
      {err && <Alert type="danger" message={err} />}
      {depts.length === 0 ? (
        <Empty message="No departments yet." />
      ) : (
        <table className="data-table" style={{ marginBottom: 20 }}>
          <thead><tr><th>Name</th><th>Code</th><th></th></tr></thead>
          <tbody>
            {depts.map(d => (
              <tr key={d.id}>
                {editing === d.id ? (
                  <>
                    <td><input className="form-input" style={{ fontSize: 13 }} value={editVal.name} onChange={e => setEditVal(v => ({ ...v, name: e.target.value }))} autoFocus /></td>
                    <td><input className="form-input" style={{ fontSize: 13, width: 100 }} value={editVal.code} onChange={e => setEditVal(v => ({ ...v, code: e.target.value }))} /></td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleSaveEdit(d.id)}><Check size={13} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(null)}><X size={13} /></button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ fontWeight: 600 }}>{d.name}</td>
                    <td>{d.code || '—'}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => startEdit(d)}><Edit2 size={12} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(d)}><Trash2 size={12} /></button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="form-input" placeholder="Department name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleAdd()} style={{ flex: 1, maxWidth: 260 }} />
        <input className="form-input" style={{ maxWidth: 140 }} placeholder="Code (optional)" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        <button className="btn btn-primary" onClick={handleAdd}><Plus size={15} /> Add Department</button>
      </div>

      <Confirm open={!!deleteConfirm} message={`Delete the "${deleteConfirm?.name}" department? This cannot be undone.`} danger
        onConfirm={confirmDelete} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}

// ── Locations (Industry-Adaptive Platform Phase 6) ──
function LocationsTab() {
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', code: '', location_type: 'other', address: '' })
  const [editing, setEditing] = useState(null)
  const [editVal, setEditVal] = useState({})
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try { setRows(await listLocations(profile.organization_id)) } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  async function handleAdd() {
    if (!form.name.trim()) return
    setErr('')
    try { await createLocation(profile.organization_id, form); setForm({ name: '', code: '', location_type: 'other', address: '' }); await load() }
    catch (e) { setErr(e.message) }
  }
  function startEdit(r) { setEditing(r.id); setEditVal({ name: r.name, code: r.code || '', location_type: r.location_type, address: r.address || '' }) }
  async function handleSaveEdit(id) {
    if (!editVal.name?.trim()) return
    setErr('')
    try { await updateLocation(id, editVal); setEditing(null); await load() }
    catch (e) { setErr(e.message) }
  }
  async function confirmDelete() {
    try { await deleteLocation(deleteConfirm.id); setDeleteConfirm(null); await load() }
    catch (e) { setErr(e.message); setDeleteConfirm(null) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Locations</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>Sites, plants, stores, warehouses or any place work happens — used by Work Items and (later) task assignment.</p>
      {err && <Alert type="danger" message={err} />}
      {rows.length === 0 ? (
        <Empty message="No locations yet." />
      ) : (
        <table className="data-table" style={{ marginBottom: 20 }}>
          <thead><tr><th>Name</th><th>Code</th><th>Type</th><th>Address</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                {editing === r.id ? (
                  <>
                    <td><input className="form-input" style={{ fontSize: 13 }} value={editVal.name} onChange={e => setEditVal(v => ({ ...v, name: e.target.value }))} autoFocus /></td>
                    <td><input className="form-input" style={{ fontSize: 13, width: 90 }} value={editVal.code} onChange={e => setEditVal(v => ({ ...v, code: e.target.value }))} /></td>
                    <td>
                      <select className="form-select" style={{ fontSize: 13 }} value={editVal.location_type} onChange={e => setEditVal(v => ({ ...v, location_type: e.target.value }))}>
                        {LOCATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td><input className="form-input" style={{ fontSize: 13 }} value={editVal.address} onChange={e => setEditVal(v => ({ ...v, address: e.target.value }))} /></td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleSaveEdit(r.id)}><Check size={13} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(null)}><X size={13} /></button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{r.code || '—'}</td>
                    <td style={{ textTransform: 'capitalize' }}>{r.location_type}</td>
                    <td style={{ color: 'var(--ink-muted)' }}>{r.address || '—'}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => startEdit(r)}><Edit2 size={12} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(r)}><Trash2 size={12} /></button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input className="form-input" placeholder="Location name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ flex: 1, minWidth: 180, maxWidth: 260 }} />
        <input className="form-input" style={{ maxWidth: 110 }} placeholder="Code (optional)" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
        <select className="form-select" style={{ maxWidth: 160 }} value={form.location_type} onChange={e => setForm(f => ({ ...f, location_type: e.target.value }))}>
          {LOCATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="form-input" placeholder="Address (optional)" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} style={{ flex: 1, minWidth: 180 }} />
        <button className="btn btn-primary" onClick={handleAdd}><Plus size={15} /> Add Location</button>
      </div>

      <Confirm open={!!deleteConfirm} message={`Delete the "${deleteConfirm?.name}" location? This cannot be undone.`} danger
        onConfirm={confirmDelete} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}
const LOCATION_TYPES = ['office','branch','site','plant','store','warehouse','hospital','farm','customer_location','other']

// ── Teams (Industry-Adaptive Platform Phase 6) ──
function TeamsTab() {
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', lead_id: '' })
  const [editing, setEditing] = useState(null)
  const [editVal, setEditVal] = useState({})
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [addMemberId, setAddMemberId] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try {
      const [t, p] = await Promise.all([
        listTeams(profile.organization_id),
        supabase.from('profiles').select('id, full_name').eq('organization_id', profile.organization_id).order('full_name'),
      ])
      setRows(t); setPeople(p.data || [])
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  async function handleAdd() {
    if (!form.name.trim()) return
    setErr('')
    try { await createTeam(profile.organization_id, form); setForm({ name: '', lead_id: '' }); await load() }
    catch (e) { setErr(e.message) }
  }
  function startEdit(r) { setEditing(r.id); setEditVal({ name: r.name, lead_id: r.lead_id || '' }) }
  async function handleSaveEdit(id) {
    if (!editVal.name?.trim()) return
    setErr('')
    try { await updateTeam(id, editVal); setEditing(null); await load() }
    catch (e) { setErr(e.message) }
  }
  async function confirmDelete() {
    try { await deleteTeam(deleteConfirm.id); setDeleteConfirm(null); await load() }
    catch (e) { setErr(e.message); setDeleteConfirm(null) }
  }
  async function handleAddMember(teamId) {
    if (!addMemberId) return
    try { await addTeamMember(teamId, addMemberId); setAddMemberId(''); await load() }
    catch (e) { setErr(e.message) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Teams</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>Crews, squads or working groups — independent of Departments, though a team can optionally sit under one later.</p>
      {err && <Alert type="danger" message={err} />}
      {rows.length === 0 ? <Empty message="No teams yet." /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {rows.map(r => (
            <div key={r.id} className="card" style={{ padding: 14 }}>
              {editing === r.id ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="form-input" style={{ fontSize: 13, flex: 1 }} value={editVal.name} onChange={e => setEditVal(v => ({ ...v, name: e.target.value }))} autoFocus />
                  <select className="form-select" style={{ fontSize: 13, maxWidth: 180 }} value={editVal.lead_id} onChange={e => setEditVal(v => ({ ...v, lead_id: e.target.value }))}>
                    <option value="">No lead</option>
                    {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleSaveEdit(r.id)}><Check size={13} /></button>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(null)}><X size={13} /></button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                      {r.lead?.full_name ? `Lead: ${r.lead.full_name} · ` : ''}{r.members?.length || 0} member{r.members?.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>{expanded === r.id ? 'Hide' : 'Manage'}</button>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => startEdit(r)}><Edit2 size={12} /></button>
                  <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(r)}><Trash2 size={12} /></button>
                </div>
              )}
              {expanded === r.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  {(r.members || []).map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                      <span style={{ flex: 1 }}>{m.person?.full_name}</span>
                      <span style={{ color: 'var(--ink-muted)', fontSize: 11 }}>{m.role}</span>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => removeTeamMember(m.id).then(load)}><X size={12} /></button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <select className="form-select" style={{ fontSize: 13, flex: 1 }} value={addMemberId} onChange={e => setAddMemberId(e.target.value)}>
                      <option value="">Add member…</option>
                      {people.filter(p => !(r.members || []).some(m => m.person_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleAddMember(r.id)}>Add</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="form-input" placeholder="Team name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ flex: 1, maxWidth: 260 }} />
        <select className="form-select" style={{ maxWidth: 180 }} value={form.lead_id} onChange={e => setForm(f => ({ ...f, lead_id: e.target.value }))}>
          <option value="">No lead</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <button className="btn btn-primary" onClick={handleAdd}><Plus size={15} /> Add Team</button>
      </div>

      <Confirm open={!!deleteConfirm} message={`Delete the "${deleteConfirm?.name}" team? This cannot be undone.`} danger
        onConfirm={confirmDelete} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}

// ── Shifts (Industry-Adaptive Platform Phase 6) ──
function ShiftsTab() {
  const { profile } = useAuth()
  const [patterns, setPatterns] = useState([])
  const [assignments, setAssignments] = useState([])
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', pattern_type: 'fixed', start_time: '09:00', end_time: '18:00' })
  const [assignForm, setAssignForm] = useState({ person_id: '', shift_pattern_id: '', effective_from: new Date().toISOString().slice(0, 10) })
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try {
      const [pat, asn, ppl] = await Promise.all([
        listShiftPatterns(profile.organization_id),
        listShiftAssignments(profile.organization_id),
        supabase.from('profiles').select('id, full_name').eq('organization_id', profile.organization_id).order('full_name'),
      ])
      setPatterns(pat); setAssignments(asn); setPeople(ppl.data || [])
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  async function handleAddPattern() {
    if (!form.name.trim()) return
    setErr('')
    try { await createShiftPattern(profile.organization_id, form); setForm({ name: '', pattern_type: 'fixed', start_time: '09:00', end_time: '18:00' }); await load() }
    catch (e) { setErr(e.message) }
  }
  async function handleAssign() {
    if (!assignForm.person_id || !assignForm.shift_pattern_id) return
    setErr('')
    try { await assignShift(profile.organization_id, assignForm.person_id, assignForm.shift_pattern_id, assignForm.effective_from); await load() }
    catch (e) { setErr(e.message) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Shifts</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>Define shift patterns and assign people to them. Shown as context on My Work — never gates check-in.</p>
      {err && <Alert type="danger" message={err} />}

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Shift Patterns</div>
      {patterns.length === 0 ? <Empty message="No shift patterns yet." /> : (
        <table className="data-table" style={{ marginBottom: 16 }}>
          <thead><tr><th>Name</th><th>Type</th><th>Start</th><th>End</th></tr></thead>
          <tbody>{patterns.map(p => (
            <tr key={p.id}><td style={{ fontWeight: 600 }}>{p.name}</td><td style={{ textTransform: 'capitalize' }}>{p.pattern_type}</td><td>{p.start_time || '—'}</td><td>{p.end_time || '—'}</td></tr>
          ))}</tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
        <input className="form-input" placeholder="Pattern name (e.g. Day Shift)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ flex: 1, minWidth: 180, maxWidth: 220 }} />
        <select className="form-select" style={{ maxWidth: 140 }} value={form.pattern_type} onChange={e => setForm(f => ({ ...f, pattern_type: e.target.value }))}>
          {['fixed','flexible','rotational','night','split'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="time" className="form-input" style={{ maxWidth: 120 }} value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
        <input type="time" className="form-input" style={{ maxWidth: 120 }} value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
        <button className="btn btn-primary" onClick={handleAddPattern}><Plus size={15} /> Add Pattern</button>
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Assignments</div>
      {assignments.length === 0 ? <Empty message="No one is assigned to a shift yet." /> : (
        <table className="data-table" style={{ marginBottom: 16 }}>
          <thead><tr><th>Person</th><th>Shift</th><th>From</th><th>To</th></tr></thead>
          <tbody>{assignments.map(a => (
            <tr key={a.id}><td>{a.person?.full_name}</td><td>{a.shift?.name}</td><td>{dateFmt(a.effective_from)}</td><td>{a.effective_to ? dateFmt(a.effective_to) : 'Ongoing'}</td></tr>
          ))}</tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select className="form-select" style={{ maxWidth: 180 }} value={assignForm.person_id} onChange={e => setAssignForm(f => ({ ...f, person_id: e.target.value }))}>
          <option value="">Select person…</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <select className="form-select" style={{ maxWidth: 180 }} value={assignForm.shift_pattern_id} onChange={e => setAssignForm(f => ({ ...f, shift_pattern_id: e.target.value }))}>
          <option value="">Select shift…</option>
          {patterns.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" className="form-input" style={{ maxWidth: 160 }} value={assignForm.effective_from} onChange={e => setAssignForm(f => ({ ...f, effective_from: e.target.value }))} />
        <button className="btn btn-primary" onClick={handleAssign}>Assign</button>
      </div>
    </div>
  )
}

// ── Work Types (Industry-Adaptive Platform Phase 8) ──
// Admin CRUD over work_type_configs (STEP182) — the org-scoped lookup
// WorkItemsPage.jsx's type picker/filter reads from. Deactivate rather
// than hard-delete: work_items.work_type_key is a soft ref by key, so a
// deleted row would just silently orphan any existing work items still
// carrying that key with no way to look its label back up.
function WorkTypesTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ key: '', name: '' })
  const [editing, setEditing] = useState(null)
  const [editVal, setEditVal] = useState({ name: '' })
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try { setRows(await listAllWorkTypeConfigs()) } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  async function handleAdd() {
    if (!form.key.trim() || !form.name.trim()) return
    setErr('')
    try { await createWorkTypeConfig(form.key.trim().toLowerCase().replace(/\s+/g, '_'), form.name.trim()); setForm({ key: '', name: '' }); await load() }
    catch (e) { setErr(e.message) }
  }
  function startEdit(r) { setEditing(r.id); setEditVal({ name: r.name }) }
  async function handleSaveEdit(id) {
    if (!editVal.name.trim()) return
    setErr('')
    try { await updateWorkTypeConfig(id, { name: editVal.name.trim() }); setEditing(null); await load() }
    catch (e) { setErr(e.message) }
  }
  async function toggleActive(r) {
    try { await updateWorkTypeConfig(r.id, { active: !r.active }); await load() } catch (e) { setErr(e.message) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Work Types</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>
        The types available when creating a Work Order, Service Request or other non-Project work item.
      </p>
      {err && <Alert type="danger" message={err} />}
      {rows.length === 0 ? <Empty message="No work types yet." /> : (
        <table className="data-table" style={{ marginBottom: 20 }}>
          <thead><tr><th>Name</th><th>Key</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                {editing === r.id ? (
                  <>
                    <td><input className="form-input" style={{ fontSize: 13 }} value={editVal.name} onChange={e => setEditVal({ name: e.target.value })} autoFocus /></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.key}</td>
                    <td>{r.active ? 'Active' : 'Inactive'}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleSaveEdit(r.id)}><Check size={13} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(null)}><X size={13} /></button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-muted)' }}>{r.key}</td>
                    <td>{r.active ? 'Active' : 'Inactive'}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => startEdit(r)}><Edit2 size={12} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(r)}>{r.active ? 'Deactivate' : 'Activate'}</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="form-input" placeholder="Key (e.g. site_visit)" value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))} style={{ maxWidth: 200 }} />
        <input className="form-input" placeholder="Display name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleAdd()} style={{ flex: 1, maxWidth: 260 }} />
        <button className="btn btn-primary" onClick={handleAdd}><Plus size={15} /> Add Work Type</button>
      </div>
    </div>
  )
}

// ── Task Status Flows (STEP198) — master panel: each department gets its
// own independently-configurable ordered status pipeline (Application:
// Backlog/Todo/Analysis/...; Firmware: Backlog/POC/Pilot/Test/...), plus
// a dedicated "Unassigned" flow for tasks with no department — every
// department, including "none", is a real editable flow row, no
// hardcoded fallback. Renaming a step's label/color, or reordering, is
// always safe (status_key is untouched). REMOVING a step is the only
// destructive edit — if any task still holds that status, Save requires
// picking where each of those tasks should land in the new flow before
// it commits (bulk remap + logs into task_change_log, STEP197).
function slugifyStatusKey(label) {
  return (label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
function StatusFlowsTab() {
  const { profile } = useAuth()
  const [depts, setDepts] = useState([])
  const [flows, setFlows] = useState([])       // [{id, department_id, steps:[...]}]
  const [selectedDept, setSelectedDept] = useState(null) // department id, or null = Unassigned
  const [draftSteps, setDraftSteps] = useState([])
  const [newLabel, setNewLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [remapNeeded, setRemapNeeded] = useState(null) // {removedKeys, mapping} while resolving a destructive save

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true); setErr('')
    try {
      const [d, f] = await Promise.all([listDepartments(profile.organization_id), listFlows(profile.organization_id)])
      setDepts(d); setFlows(f)
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  const currentFlow = useMemo(
    () => flows.find(f => (selectedDept ? f.department_id === selectedDept : f.department_id === null)),
    [flows, selectedDept],
  )
  useEffect(() => { setDraftSteps(currentFlow ? currentFlow.steps.map(s => ({ ...s })) : []); setRemapNeeded(null) }, [currentFlow])

  function addStep() {
    const label = newLabel.trim()
    if (!label) return
    let key = slugifyStatusKey(label)
    if (!key) return
    // Auto-disambiguate a colliding key (e.g. adding "POC" twice) instead of silently overwriting.
    let n = 2; const base = key
    while (draftSteps.some(s => s.status_key === key)) { key = `${base}_${n}`; n++ }
    setDraftSteps(prev => [...prev, { status_key: key, label, color: '#6366f1', is_closed: false, progress_pct: 0 }])
    setNewLabel('')
  }
  function removeStep(key) { setDraftSteps(prev => prev.filter(s => s.status_key !== key)) }
  function moveStep(i, dir) {
    setDraftSteps(prev => {
      const next = [...prev]; const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  function patchStep(key, patch) { setDraftSteps(prev => prev.map(s => s.status_key === key ? { ...s, ...patch } : s)) }

  async function handleSave() {
    setErr('')
    try {
      const flowId = currentFlow?.id || await ensureFlow(profile.organization_id, selectedDept)
      const removedKeys = (currentFlow?.steps || []).map(s => s.status_key).filter(k => !draftSteps.some(s => s.status_key === k))
      if (removedKeys.length) {
        const inUse = new Set(await distinctStatusesInUse(profile.organization_id, selectedDept))
        const needsRemap = removedKeys.filter(k => inUse.has(k))
        if (needsRemap.length) {
          setRemapNeeded({ flowId, keys: needsRemap, mapping: Object.fromEntries(needsRemap.map(k => [k, draftSteps[0]?.status_key || ''])) })
          return
        }
      }
      await saveFlowSteps(flowId, profile.organization_id, draftSteps)
      await load()
    } catch (e) { setErr(e.message) }
  }

  async function confirmRemapAndSave() {
    setSaving(true); setErr('')
    try {
      if (Object.values(remapNeeded.mapping).some(v => !v)) throw new Error('Choose a destination status for every affected task before saving.')
      await remapTaskStatuses(profile.organization_id, selectedDept, remapNeeded.mapping, profile.id)
      await saveFlowSteps(remapNeeded.flowId, profile.organization_id, draftSteps)
      setRemapNeeded(null)
      await load()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <Loader />

  const deptOptions = [{ id: null, name: 'Unassigned (no department)' }, ...depts]

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Task Status Flows</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20, maxWidth: 640 }}>
        Each department has its own ordered status pipeline for Task Management's Kanban board and status dropdowns —
        e.g. Application might flow Backlog → Todo → Analysis, while Firmware flows Backlog → POC → Pilot → Test.
        "Unassigned" is the flow used by tasks with no department set. The % next to each step feeds the
        weighted project completion shown in Task Management → Reports (e.g. Todo 0%, In Progress 30%, QA 60%, Ready to Deploy 80%, Done 100%).
      </p>
      {err && <Alert type="danger" message={err} />}

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: 220, flexShrink: 0 }}>
          {deptOptions.map(d => {
            const active = (selectedDept ?? null) === (d.id ?? null)
            const flow = flows.find(f => (d.id ? f.department_id === d.id : f.department_id === null))
            return (
              <button key={d.id ?? '__none'} onClick={() => setSelectedDept(d.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 9, border: 'none', marginBottom: 3,
                  background: active ? 'var(--surface-2)' : 'transparent', color: active ? 'var(--c1)' : 'var(--ink-soft)', fontWeight: active ? 700 : 500, fontSize: 13, cursor: 'pointer' }}>
                {d.name}
                <div style={{ fontSize: 10.5, color: 'var(--ink-muted)', fontWeight: 400 }}>{flow?.steps?.length ?? 0} steps</div>
              </button>
            )
          })}
        </div>

        <div style={{ flex: '1 1 380px', minWidth: 320 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {draftSteps.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', fontStyle: 'italic' }}>No steps yet — add the first one below.</div>}
            {draftSteps.map((s, i) => (
              <div key={s.status_key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <button className="btn btn-ghost btn-sm btn-icon" style={{ width: 20, height: 16, minHeight: 0 }} disabled={i === 0} onClick={() => moveStep(i, -1)}><ArrowUp size={11} /></button>
                  <button className="btn btn-ghost btn-sm btn-icon" style={{ width: 20, height: 16, minHeight: 0 }} disabled={i === draftSteps.length - 1} onClick={() => moveStep(i, 1)}><ArrowDown size={11} /></button>
                </div>
                <input type="color" value={s.color} onChange={e => patchStep(s.status_key, { color: e.target.value })} style={{ width: 28, height: 28, padding: 0, border: 'none', borderRadius: 6, flexShrink: 0 }} />
                <input className="form-input" value={s.label} onChange={e => patchStep(s.status_key, { label: e.target.value })} style={{ flex: 1, fontSize: 13 }} />
                <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontFamily: 'monospace', flexShrink: 0 }}>{s.status_key}</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ink-muted)', flexShrink: 0 }} title="Used to show a weighted completion % per project in Task Management → Reports">
                  <input type="number" min={0} max={100} value={s.progress_pct ?? ''} placeholder="0"
                    onChange={e => patchStep(s.status_key, { progress_pct: e.target.value === '' ? null : Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })}
                    style={{ width: 46, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, textAlign: 'right' }} />%
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ink-muted)', flexShrink: 0, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!s.is_closed} onChange={e => patchStep(s.status_key, { is_closed: e.target.checked, progress_pct: e.target.checked ? 100 : s.progress_pct })} style={{ accentColor: 'var(--c1)' }} /> Done
                </label>
                <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444', flexShrink: 0 }} onClick={() => removeStep(s.status_key)}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input className="form-input" placeholder="New step name (e.g. Analysis)" value={newLabel}
              onChange={e => setNewLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && addStep()} style={{ flex: 1 }} />
            <button className="btn btn-outline" onClick={addStep}><Plus size={14} /> Add Step</button>
          </div>

          {remapNeeded ? (
            <div style={{ padding: 14, borderRadius: 10, border: '1px solid #f59e0b40', background: '#f59e0b0c' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Some tasks are on a status you're removing</div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 10 }}>Choose where each affected task should move to before saving.</p>
              {remapNeeded.keys.map(k => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontFamily: 'monospace', minWidth: 100 }}>{k}</span>
                  <ChevronRight size={13} style={{ color: 'var(--ink-muted)' }} />
                  <select className="form-select" value={remapNeeded.mapping[k] || ''} style={{ flex: 1 }}
                    onChange={e => setRemapNeeded(r => ({ ...r, mapping: { ...r.mapping, [k]: e.target.value } }))}>
                    <option value="">Select new status…</option>
                    {draftSteps.map(s => <option key={s.status_key} value={s.status_key}>{s.label}</option>)}
                  </select>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button className="btn btn-primary btn-sm" disabled={saving} onClick={confirmRemapAndSave}>{saving ? 'Saving…' : 'Confirm & Save'}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setRemapNeeded(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={handleSave}><Save size={14} /> Save Flow</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Task Templates (Industry-Adaptive Platform Phase 8) ──
// Closes the gap Phase 4 explicitly left open ("Task Templates picker
// skipped ... no admin UI anywhere to create one yet"). Checklist items
// use the exact shape MyWorkPage.jsx's completion flow already expects:
// { id, label, type, required, value }. Applying a template happens from
// WorkItemsPage.jsx's "+ New Task" flow (createTaskForWorkItem), not
// TasksPage.jsx — that file's saveTask() doesn't persist `checklist` in
// its payload at all, so wiring template-apply there would have meant
// also extending a function three prior phases already touched; a lower
// -risk landing spot the parent phase's own directive explicitly allowed.
let templateItemSeq = 0

function TaskTemplatesTab() {
  const { profile } = useAuth()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // template row being edited, or {} for new
  const [form, setForm] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try { setTemplates(await listTaskTemplates()) } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  function openNew() {
    setEditing({})
    setForm({ name: '', taskType: '', estimatedHours: '', requiresApproval: false, checklist: [] })
  }
  function openEdit(t) {
    setEditing(t)
    setForm({ name: t.name, taskType: t.task_type || '', estimatedHours: t.estimated_hours || '', requiresApproval: t.requires_approval, checklist: (t.default_checklist || []).map(i => ({ ...i })) })
  }
  function addChecklistItem() {
    templateItemSeq += 1
    setForm(f => ({ ...f, checklist: [...f.checklist, { id: `tpl_${Date.now()}_${templateItemSeq}`, label: '', type: 'text', required: false, value: null }] }))
  }
  function updateChecklistItem(id, patch) {
    setForm(f => ({ ...f, checklist: f.checklist.map(i => i.id === id ? { ...i, ...patch } : i) }))
  }
  function removeChecklistItem(id) {
    setForm(f => ({ ...f, checklist: f.checklist.filter(i => i.id !== id) }))
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setErr('')
    try {
      if (editing?.id) await updateTaskTemplate(editing.id, form)
      else await createTaskTemplate(form, profile.id)
      setEditing(null); setForm(null); await load()
    } catch (e) { setErr(e.message) }
  }
  async function confirmDelete() {
    try { await deleteTaskTemplate(deleteConfirm.id); setDeleteConfirm(null); await load() }
    catch (e) { setErr(e.message); setDeleteConfirm(null) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Task Templates</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>
        Reusable task presets — name, type, estimated hours and a checklist. Applied from a Work Item's "+ New Task" action.
      </p>
      {err && <Alert type="danger" message={err} />}

      {!editing && (
        <>
          {templates.length === 0 ? <Empty message="No task templates yet." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {templates.map(t => (
                <div key={t.id} className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>
                      {t.task_type ? `${t.task_type} · ` : ''}{(t.default_checklist || []).length} checklist item{(t.default_checklist || []).length === 1 ? '' : 's'}
                      {t.requires_approval ? ' · requires approval' : ''}{t.estimated_hours ? ` · ~${t.estimated_hours}h` : ''}
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(t)}><Edit2 size={13} /></button>
                  <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(t)}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> New Template</button>
        </>
      )}

      {editing && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <input className="form-input" placeholder="Template name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ flex: 1 }} />
              <input className="form-input" placeholder="Task type (optional)" value={form.taskType} onChange={e => setForm(f => ({ ...f, taskType: e.target.value }))} style={{ maxWidth: 180 }} />
              <input className="form-input" type="number" placeholder="Est. hours" value={form.estimatedHours} onChange={e => setForm(f => ({ ...f, estimatedHours: e.target.value }))} style={{ maxWidth: 120 }} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={form.requiresApproval} onChange={e => setForm(f => ({ ...f, requiresApproval: e.target.checked }))} />
              Requires approval on completion
            </label>
          </div>

          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 8 }}>Checklist</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            {form.checklist.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="form-input" placeholder="Item label" value={item.label} onChange={e => updateChecklistItem(item.id, { label: e.target.value })} style={{ flex: 1 }} />
                <select className="form-select" value={item.type} onChange={e => updateChecklistItem(item.id, { type: e.target.value })} style={{ maxWidth: 150 }}>
                  {CHECKLIST_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={item.required} onChange={e => updateChecklistItem(item.id, { required: e.target.checked })} /> Required
                </label>
                <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => removeChecklistItem(item.id)}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={addChecklistItem}><Plus size={13} /> Add checklist item</button>

          <div style={{ display: 'flex', gap: 8, marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-primary" onClick={handleSave}>Save Template</button>
            <button className="btn btn-ghost" onClick={() => { setEditing(null); setForm(null) }}>Cancel</button>
          </div>
        </div>
      )}

      <Confirm open={!!deleteConfirm} message={`Delete the "${deleteConfirm?.name}" template? This cannot be undone.`} danger
        onConfirm={confirmDelete} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}

// ── Task Field Rules (STEP226) ──
// Org-wide "is this field required" toggles for the Task create/edit
// form (TasksPage.jsx's TaskForm) — every field that form exposes, with
// two independent checkboxes each, since a field can reasonably be
// optional on quick-create but mandatory by the time someone edits it
// (or vice versa). Enforced client-side in TasksPage.jsx's saveTask().
function TaskFieldRulesTab() {
  const { profile } = useAuth()
  const [rules, setRules] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try { setRules(fieldRulesToMap(await listTaskFieldRules())) } catch (e) { setErr(e.message) }
    setLoading(false)
  }
  function toggle(key, field, checked) {
    setSaved(false)
    setRules(r => ({ ...r, [key]: { required_on_create: false, required_on_edit: false, ...r[key], [field]: checked } }))
  }
  async function handleSave() {
    setSaving(true); setErr(''); setSaved(false)
    try {
      await saveTaskFieldRules(
        TASK_FIELD_CATALOG.map(f => ({ field_key: f.key, ...(rules[f.key] || { required_on_create: false, required_on_edit: false }) })),
        profile.organization_id,
      )
      setSaved(true)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Task Field Rules</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>
        Choose which fields on the Task form must be filled in — separately for creating a new task and for editing an existing one. A field with neither box ticked stays optional.
      </p>
      {err && <Alert type="danger" message={err} />}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <table className="data-table">
          <thead><tr><th>Field</th><th style={{ textAlign: 'center' }}>Required on Create</th><th style={{ textAlign: 'center' }}>Required on Edit</th></tr></thead>
          <tbody>
            {TASK_FIELD_CATALOG.map(f => (
              <tr key={f.key}>
                <td style={{ fontWeight: 600 }}>{f.label}</td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={!!rules[f.key]?.required_on_create} onChange={e => toggle(f.key, 'required_on_create', e.target.checked)} />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={!!rules[f.key]?.required_on_edit} onChange={e => toggle(f.key, 'required_on_edit', e.target.checked)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        {saved && <span style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>Saved</span>}
      </div>
    </div>
  )
}

// ── Task Detail View (STEP227) ──
// Org-wide switch for how clicking a task in Task Management opens it:
// the original centered dialog ("Default") or a right-side sliding
// drawer ("Template 1"). Same TaskDetail content either way — only the
// container changes (TasksPage.jsx picks Modal vs TaskDetailDrawer).
const VIEW_STYLE_OPTIONS = [
  { value: 'modal',  name: 'Default',    desc: 'Task opens in a centered dialog, like today.' },
  { value: 'drawer', name: 'Template 1', desc: 'Task opens in a panel that slides in from the right edge of the screen.' },
]
function TaskViewSettingsTab() {
  const { profile } = useAuth()
  const [style, setStyle] = useState('modal')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try { setStyle(await getTaskDetailViewStyle()) } catch (e) { setErr(e.message) }
    setLoading(false)
  }
  async function choose(value) {
    if (value === style) return
    setSaving(true); setErr(''); setSaved(false)
    try { await setTaskDetailViewStyle(value, profile.organization_id); setStyle(value); setSaved(true) }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Task Detail View</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>
        Choose how a task opens when clicked in Task Management, for everyone in the organization.
      </p>
      {err && <Alert type="danger" message={err} />}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {VIEW_STYLE_OPTIONS.map(opt => {
          const active = style === opt.value
          return (
            <button key={opt.value} type="button" onClick={() => choose(opt.value)} disabled={saving}
              className="card" style={{
                width: 220, padding: 14, textAlign: 'left', cursor: saving ? 'default' : 'pointer',
                border: active ? '2px solid var(--c1, #6366f1)' : '1px solid var(--border)',
                background: 'var(--surface)',
              }}>
              {/* Tiny layout preview — a mock "screen" with the dialog either centered or docked right */}
              <div style={{ width: '100%', height: 70, borderRadius: 8, background: 'var(--bg-3)', position: 'relative', overflow: 'hidden', marginBottom: 10 }}>
                {opt.value === 'modal'
                  ? <div style={{ position: 'absolute', inset: '14px 50px', borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--border)' }} />
                  : <div style={{ position: 'absolute', top: 6, bottom: 6, right: 6, width: 60, borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--border)' }} />}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, marginBottom: 3 }}>
                {opt.name}
                {active && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--c1, #6366f1)' }}>· Active</span>}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{opt.desc}</div>
            </button>
          )
        })}
      </div>
      {saved && <div style={{ marginTop: 14, fontSize: 12, color: '#10b981', fontWeight: 600 }}>Saved — everyone will see this the next time they open a task.</div>}
    </div>
  )
}

// ── Workspace Administration (Industry-Adaptive Platform Phase 8) ──
// The path an EXISTING organization uses to voluntarily opt into
// everything Phases 1-7 built. Phase 2's onboarding wizard only ever
// fires for brand-new signups (handle_new_user()'s 'create' branch) —
// until this tab existed, there was no way for an org that predates this
// whole build to ever get a non-null industry_profile_id. Reuses the
// exact same data-fetching (lib/workspace.js) and recommendation rule
// table (lib/workspaceRecommendation.js) the onboarding wizard already
// uses — no duplicated logic.
function WorkspaceTab() {
  const { workspace, refresh: refreshWorkspace } = useWorkspace()
  const [industries, setIndustries] = useState([])
  const [businessTypes, setBusinessTypes] = useState([])
  const [operatingModels, setOperatingModels] = useState([])
  const [selectedModelIds, setSelectedModelIds] = useState([])
  const [industryId, setIndustryId] = useState('')
  const [businessTypeId, setBusinessTypeId] = useState('')
  const [enabledKeys, setEnabledKeys] = useState(new Set())
  const [dashboardKeys, setDashboardKeys] = useState(null) // null = show everything (legacy)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [revertConfirm, setRevertConfirm] = useState(false)

  useEffect(() => { load() }, [workspace?.id])
  async function load() {
    if (!workspace) return
    setLoading(true)
    try {
      const [inds, models, links] = await Promise.all([
        listIndustryProfiles(), listOperatingModels(), listWorkspaceOperatingModels(workspace.id),
      ])
      setIndustries(inds)
      setOperatingModels(models)
      setSelectedModelIds(links.map(l => l.operating_model_id))
      setIndustryId(workspace.industry_profile_id || '')
      setBusinessTypeId(workspace.business_type_id || '')
      setEnabledKeys(new Set(MODULES.map(m => m.key).filter(k => isModuleInWorkspace(workspace, k))))
      setDashboardKeys(workspace.dashboard_widget_keys || null)
      if (workspace.industry_profile_id) setBusinessTypes(await listBusinessTypes(workspace.industry_profile_id))
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  async function onIndustryChange(id) {
    setIndustryId(id)
    setBusinessTypeId('')
    setBusinessTypes(id ? await listBusinessTypes(id) : [])
  }

  function toggleModel(id) {
    setSelectedModelIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }
  function toggleModule(key) {
    setEnabledKeys(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  }
  function toggleDashboardWidget(key) {
    setDashboardKeys(prev => {
      const base = prev || DASHBOARD_WIDGETS.map(w => w.key) // first toggle starts from "everything on"
      return base.includes(key) ? base.filter(k => k !== key) : [...base, key]
    })
  }

  const industryKey = industries.find(i => i.id === industryId)?.key
  const selectedModelKeys = operatingModels.filter(m => selectedModelIds.includes(m.id)).map(m => m.key)
  const recommended = useMemo(() => recommendModuleKeys(industryKey, selectedModelKeys), [industryKey, selectedModelKeys])

  function applyRecommendation() { setEnabledKeys(new Set(recommended)) }

  async function handleSave() {
    setSaving(true); setErr('')
    try {
      await updateWorkspaceProfile(workspace.id, {
        industry_profile_id: industryId || null,
        business_type_id: businessTypeId || null,
        enabled_module_keys: Array.from(enabledKeys),
        known_module_keys: MODULES.map(m => m.key),
        dashboard_widget_keys: dashboardKeys,
        is_legacy_default: false,
      })
      await setWorkspaceOperatingModels(workspace.id, selectedModelIds)
      await refreshWorkspace()
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) { setErr(e.message) }
    setSaving(false)
  }

  async function handleRevert() {
    setSaving(true); setErr('')
    try {
      // Field-for-field match of STEP180's original legacy-default seed
      // — the same "no override" values every pre-existing org already
      // has, so this is a genuine, complete undo, not a partial one.
      await updateWorkspaceProfile(workspace.id, {
        industry_profile_id: null, business_type_id: null,
        enabled_module_keys: null, known_module_keys: null, terminology_overrides: {},
        dashboard_widget_keys: null, is_legacy_default: true,
      })
      await setWorkspaceOperatingModels(workspace.id, [])
      await refreshWorkspace()
      setRevertConfirm(false)
      await load()
    } catch (e) { setErr(e.message) }
    setSaving(false)
  }

  if (loading || !workspace) return <Loader />

  const modulesBySection = new Map()
  for (const m of MODULES) { if (!modulesBySection.has(m.section)) modulesBySection.set(m.section, []); modulesBySection.get(m.section).push(m) }

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Workspace</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 16 }}>
        Tell us how your organization works so navigation, terminology and the dashboard can adapt — same setup new organizations see during onboarding.
      </p>
      {err && <Alert type="danger" message={err} />}
      {saved && <Alert type="success" message="Workspace configuration saved." />}

      <div className="card" style={{ padding: 14, marginBottom: 20, background: workspace.is_legacy_default ? 'var(--surface)' : '#f0fdf4', border: workspace.is_legacy_default ? undefined : '1px solid #86efac' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          {workspace.is_legacy_default ? 'Not yet configured' : 'Configured workspace'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
          {workspace.is_legacy_default
            ? "This organization is using the default experience — every module visible, no industry-specific terminology. Configure below to change that."
            : `Industry: ${workspace.industry_profile?.name || '—'}${workspace.business_type?.name ? ` · ${workspace.business_type.name}` : ''}`}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 24 }}>
        <div>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 6, display: 'block' }}>Industry</label>
          <select className="form-select" value={industryId} onChange={e => onIndustryChange(e.target.value)} style={{ maxWidth: 320 }}>
            <option value="">Not set</option>
            {industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        {businessTypes.length > 0 && (
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 6, display: 'block' }}>Business Type</label>
            <select className="form-select" value={businessTypeId} onChange={e => setBusinessTypeId(e.target.value)} style={{ maxWidth: 320 }}>
              <option value="">Not set</option>
              {businessTypes.map(bt => <option key={bt.id} value={bt.id}>{bt.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 6, display: 'block' }}>How does your organization primarily work?</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {operatingModels.map(m => {
              const on = selectedModelIds.includes(m.id)
              return (
                <button key={m.id} type="button" onClick={() => toggleModel(m.id)}
                  style={{ padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: on ? '1.5px solid var(--c1)' : '1.5px solid var(--border)', background: on ? 'var(--c1)11' : 'var(--surface)', color: on ? 'var(--c1)' : 'var(--ink-soft)' }}>
                  {m.name}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {recommended.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 20, background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Recommended for this selection</div>
            <button className="btn btn-ghost btn-sm" onClick={applyRecommendation}>Apply Recommendation</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {recommended.map(key => {
              const m = MODULES.find(x => x.key === key)
              return <span key={key} style={{ fontSize: 11.5, fontWeight: 600, color: '#15803d', background: '#dcfce7', padding: '4px 9px', borderRadius: 999 }}>{m?.label || key}</span>
            })}
          </div>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 10 }}>Modules</div>
      {[...modulesBySection.entries()].map(([section, mods]) => (
        <div key={section} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-muted)', marginBottom: 6 }}>{section}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {mods.map(m => {
              const on = enabledKeys.has(m.key)
              return (
                <button key={m.key} type="button" onClick={() => toggleModule(m.key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, textAlign: 'left', border: on ? '1.5px solid var(--c1)' : '1.5px solid var(--border)', background: on ? 'var(--c1)0d' : 'var(--surface)', cursor: 'pointer', fontSize: 12.5 }}>
                  <div style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, border: on ? 'none' : '1.5px solid var(--border)', background: on ? 'var(--c1)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <Check size={9} color="#fff" />}
                  </div>
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div style={{ fontWeight: 700, fontSize: '0.9rem', marginTop: 22, marginBottom: 4 }}>Dashboard Widgets</div>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 10 }}>Toggle sections on the CEO and Finance dashboards. Other role dashboards aren't configurable yet.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 24 }}>
        {DASHBOARD_WIDGETS.map(w => {
          const on = !dashboardKeys || dashboardKeys.includes(w.key)
          return (
            <button key={w.key} type="button" onClick={() => toggleDashboardWidget(w.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, textAlign: 'left', border: on ? '1.5px solid var(--c1)' : '1.5px solid var(--border)', background: on ? 'var(--c1)0d' : 'var(--surface)', cursor: 'pointer', fontSize: 12.5 }}>
              <div style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, border: on ? 'none' : '1.5px solid var(--border)', background: on ? 'var(--c1)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {on && <Check size={9} color="#fff" />}
              </div>
              {w.label}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Workspace'}</button>
        {!workspace.is_legacy_default && (
          <button className="btn btn-ghost" style={{ color: '#ef4444', marginLeft: 'auto' }} onClick={() => setRevertConfirm(true)} disabled={saving}>Revert to Legacy Default</button>
        )}
      </div>

      <Confirm open={revertConfirm} danger
        message="This clears the industry, business type, module selection and dashboard configuration, returning this organization to the default experience (everything visible, no adaptive terminology). Nothing is deleted — you can reconfigure again anytime."
        onConfirm={handleRevert} onCancel={() => setRevertConfirm(false)} />
    </div>
  )
}

// ── Onboarding & Tour (Admin Feature) ──
// Content for the first-run walkthrough (onboarding_slides) and the
// guided in-app tour (tour_steps) — STEP179. Both are org-scoped: each
// organization's admin/ceo edits their own copy, seen once per user
// (profiles.walkthrough_seen_at / tour_seen_at), re-runnable any time
// from the topbar compass button (web) once at least one active tour
// step exists.
const SLIDE_ICONS = ['Sparkles', 'ListChecks', 'CheckCircle2', 'Rocket', 'Target', 'Award', 'Compass', 'LayoutDashboard']

function OnboardingTourTab() {
  const { profile } = useAuth()
  const [slides, setSlides] = useState([])
  const [steps, setSteps] = useState([])
  const [platform, setPlatform] = useState('web')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [slideForm, setSlideForm] = useState({ title: '', body: '', icon: 'Sparkles', platform: 'both' })
  const [stepForm, setStepForm] = useState({ target_key: WEB_TOUR_TARGETS[0].key, title: '', body: '' })
  const [editingSlide, setEditingSlide] = useState(null)
  const [editingStep, setEditingStep] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // { kind: 'slide'|'step', row }

  useEffect(() => { load() }, [platform])
  async function load() {
    setLoading(true)
    try {
      const [s, t] = await Promise.all([listAllSlides(profile.organization_id), listAllTourSteps(profile.organization_id, platform)])
      setSlides(s); setSteps(t)
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  async function handleAddSlide() {
    if (!slideForm.title.trim()) return
    setErr('')
    try { await createSlide(profile.organization_id, slideForm); setSlideForm({ title: '', body: '', icon: 'Sparkles', platform: 'both' }); await load() }
    catch (e) { setErr(e.message) }
  }
  function startEditSlide(s) { setEditingSlide(s.id); setSlideForm({ title: s.title, body: s.body || '', icon: s.icon || 'Sparkles', platform: s.platform, active: s.active }) }
  async function saveEditSlide() {
    if (!slideForm.title.trim()) return
    setErr('')
    try { await updateSlide(editingSlide, { ...slideForm, active: slideForm.active ?? true }); setEditingSlide(null); setSlideForm({ title: '', body: '', icon: 'Sparkles', platform: 'both' }); await load() }
    catch (e) { setErr(e.message) }
  }
  async function toggleSlideActive(s) { try { await updateSlide(s.id, { title: s.title, body: s.body, icon: s.icon, platform: s.platform, active: !s.active }); await load() } catch (e) { setErr(e.message) } }
  async function moveSlide(s, dir) { try { await reorderSlide(slides, s.id, dir); await load() } catch (e) { setErr(e.message) } }

  async function handleAddStep() {
    if (!stepForm.title.trim() || !stepForm.target_key) return
    setErr('')
    try { await createTourStep(profile.organization_id, platform, stepForm); setStepForm({ target_key: WEB_TOUR_TARGETS[0].key, title: '', body: '' }); await load() }
    catch (e) { setErr(e.message) }
  }
  function startEditStep(s) { setEditingStep(s.id); setStepForm({ target_key: s.target_key, title: s.title, body: s.body || '', active: s.active }) }
  async function saveEditStep() {
    if (!stepForm.title.trim()) return
    setErr('')
    try { await updateTourStep(editingStep, { ...stepForm, active: stepForm.active ?? true }); setEditingStep(null); setStepForm({ target_key: WEB_TOUR_TARGETS[0].key, title: '', body: '' }); await load() }
    catch (e) { setErr(e.message) }
  }
  async function toggleStepActive(s) { try { await updateTourStep(s.id, { target_key: s.target_key, title: s.title, body: s.body, active: !s.active }); await load() } catch (e) { setErr(e.message) } }
  async function moveStep(s, dir) { try { await reorderTourStep(steps, s.id, dir); await load() } catch (e) { setErr(e.message) } }

  async function confirmDelete() {
    try {
      if (deleteConfirm.kind === 'slide') await deleteSlide(deleteConfirm.row.id)
      else await deleteTourStep(deleteConfirm.row.id)
      setDeleteConfirm(null); await load()
    } catch (e) { setErr(e.message); setDeleteConfirm(null) }
  }

  if (loading) return <Loader />

  return (
    <div>
      {err && <Alert type="danger" message={err} />}

      {/* ── Walkthrough slides ── */}
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Walkthrough Slides</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 16 }}>
        Shown once, right after first login. Applies per-platform — "Both" shows on web and mobile.
      </p>
      {slides.length === 0 ? <Empty message="No slides yet." /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {slides.map((s, idx) => {
            const Icon = LucideIconsIndex[s.icon] || Sparkles
            return (
            <div key={s.id} className="card" style={{ padding: 14, opacity: s.active ? 1 : 0.5 }}>
              {editingSlide === s.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input className="form-input" placeholder="Title" value={slideForm.title} onChange={e => setSlideForm(f => ({ ...f, title: e.target.value }))} />
                  <textarea className="form-input" placeholder="Body" rows={2} value={slideForm.body} onChange={e => setSlideForm(f => ({ ...f, body: e.target.value }))} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select className="form-input" style={{ maxWidth: 160 }} value={slideForm.icon} onChange={e => setSlideForm(f => ({ ...f, icon: e.target.value }))}>
                      {SLIDE_ICONS.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                    <select className="form-input" style={{ maxWidth: 140 }} value={slideForm.platform} onChange={e => setSlideForm(f => ({ ...f, platform: e.target.value }))}>
                      <option value="both">Web + Mobile</option>
                      <option value="web">Web only</option>
                      <option value="mobile">Mobile only</option>
                    </select>
                    <button className="btn btn-primary btn-sm" onClick={saveEditSlide}><Check size={13} /> Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingSlide(null)}><X size={13} /></button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#6366f1,#4338ca)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={16} color="#fff" />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{s.title}</div>
                    {s.body && <div style={{ color: 'var(--ink-muted)', fontSize: '0.82rem', marginTop: 2 }}>{s.body}</div>}
                    <span className="badge" style={{ marginTop: 6, display: 'inline-block' }}>{s.platform === 'both' ? 'Web + Mobile' : s.platform === 'web' ? 'Web only' : 'Mobile only'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-sm btn-icon" title="Move up" disabled={idx === 0} onClick={() => moveSlide(s, 'up')}><ArrowUp size={12} /></button>
                    <button className="btn btn-ghost btn-sm btn-icon" title="Move down" disabled={idx === slides.length - 1} onClick={() => moveSlide(s, 'down')}><ArrowDown size={12} /></button>
                    <button className="btn btn-ghost btn-sm btn-icon" title={s.active ? 'Deactivate' : 'Activate'} onClick={() => toggleSlideActive(s)}>{s.active ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => startEditSlide(s)}><Edit2 size={12} /></button>
                    <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm({ kind: 'slide', row: s })}><Trash2 size={12} /></button>
                  </div>
                </div>
              )}
            </div>
          )})}
        </div>
      )}
      <div className="card" style={{ padding: 14, marginBottom: 32, background: 'var(--surface)' }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 8 }}>Add a slide</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input className="form-input" placeholder="Title" value={slideForm.title} onChange={e => setSlideForm(f => ({ ...f, title: e.target.value }))} />
          <textarea className="form-input" placeholder="Body (optional)" rows={2} value={slideForm.body} onChange={e => setSlideForm(f => ({ ...f, body: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="form-input" style={{ maxWidth: 160 }} value={slideForm.icon} onChange={e => setSlideForm(f => ({ ...f, icon: e.target.value }))}>
              {SLIDE_ICONS.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
            <select className="form-input" style={{ maxWidth: 140 }} value={slideForm.platform} onChange={e => setSlideForm(f => ({ ...f, platform: e.target.value }))}>
              <option value="both">Web + Mobile</option>
              <option value="web">Web only</option>
              <option value="mobile">Mobile only</option>
            </select>
            <button className="btn btn-primary" onClick={handleAddSlide}><Plus size={15} /> Add Slide</button>
          </div>
        </div>
      </div>

      {/* ── Guided tour steps ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h3 style={{ fontWeight: 800, fontSize: '1.05rem' }}>Guided Tour Steps</h3>
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', borderRadius: 8, padding: 3 }}>
          {['web', 'mobile'].map(p => (
            <button key={p} onClick={() => setPlatform(p)}
              className="btn btn-sm" style={{ background: platform === p ? '#fff' : 'transparent', border: 'none', fontWeight: platform === p ? 700 : 500, boxShadow: platform === p ? '0 1px 3px rgba(0,0,0,.1)' : 'none' }}>
              {p === 'web' ? 'Web' : 'Mobile'}
            </button>
          ))}
        </div>
      </div>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 16 }}>
        Spotlight steps shown once automatically, and re-runnable any time from the {platform === 'web' ? 'topbar compass icon' : 'app'}. Each step points at a fixed UI anchor — pick from the list, free text isn't allowed since a typo would silently never find its target.
      </p>
      {steps.length === 0 ? <Empty message={`No ${platform} tour steps yet.`} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {steps.map((s, idx) => (
            <div key={s.id} className="card" style={{ padding: 14, opacity: s.active ? 1 : 0.5 }}>
              {editingStep === s.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {platform === 'web' ? (
                    <select className="form-input" value={stepForm.target_key} onChange={e => setStepForm(f => ({ ...f, target_key: e.target.value }))}>
                      {WEB_TOUR_TARGETS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                  ) : (
                    <input className="form-input" placeholder="Target key (see mobile app source)" value={stepForm.target_key} onChange={e => setStepForm(f => ({ ...f, target_key: e.target.value }))} />
                  )}
                  <input className="form-input" placeholder="Title" value={stepForm.title} onChange={e => setStepForm(f => ({ ...f, title: e.target.value }))} />
                  <textarea className="form-input" placeholder="Body" rows={2} value={stepForm.body} onChange={e => setStepForm(f => ({ ...f, body: e.target.value }))} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={saveEditStep}><Check size={13} /> Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingStep(null)}><X size={13} /></button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{s.title}</div>
                    {s.body && <div style={{ color: 'var(--ink-muted)', fontSize: '0.82rem', marginTop: 2 }}>{s.body}</div>}
                    <span className="badge" style={{ marginTop: 6, display: 'inline-block', fontFamily: 'monospace' }}>{s.target_key}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-sm btn-icon" title="Move up" disabled={idx === 0} onClick={() => moveStep(s, 'up')}><ArrowUp size={12} /></button>
                    <button className="btn btn-ghost btn-sm btn-icon" title="Move down" disabled={idx === steps.length - 1} onClick={() => moveStep(s, 'down')}><ArrowDown size={12} /></button>
                    <button className="btn btn-ghost btn-sm btn-icon" title={s.active ? 'Deactivate' : 'Activate'} onClick={() => toggleStepActive(s)}>{s.active ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => startEditStep(s)}><Edit2 size={12} /></button>
                    <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm({ kind: 'step', row: s })}><Trash2 size={12} /></button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="card" style={{ padding: 14, background: 'var(--surface)' }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 8 }}>Add a {platform} step</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {platform === 'web' ? (
            <select className="form-input" value={stepForm.target_key} onChange={e => setStepForm(f => ({ ...f, target_key: e.target.value }))}>
              {WEB_TOUR_TARGETS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          ) : (
            <input className="form-input" placeholder="Target key (see mobile app source)" value={stepForm.target_key} onChange={e => setStepForm(f => ({ ...f, target_key: e.target.value }))} />
          )}
          <input className="form-input" placeholder="Title" value={stepForm.title} onChange={e => setStepForm(f => ({ ...f, title: e.target.value }))} />
          <textarea className="form-input" placeholder="Body (optional)" rows={2} value={stepForm.body} onChange={e => setStepForm(f => ({ ...f, body: e.target.value }))} />
          <button className="btn btn-primary" onClick={handleAddStep} style={{ alignSelf: 'flex-start' }}><Plus size={15} /> Add Step</button>
        </div>
      </div>

      <Confirm open={!!deleteConfirm} message={`Delete "${deleteConfirm?.row?.title}"? This cannot be undone.`} danger
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

// ── Proposal -> Planned-Budget Category Mapping ──
// Admin control over what STEP215's "Add Cost Section" only ever set once,
// at creation time, for a single proposal — this is the one place to view
// and change the mapping for every category (standard 7 or custom) across
// the whole org. Unmapped means: that category's cost just won't seed a
// planned-budget line when a proposal is converted to a project (see
// proposalConvert.js's `if (!budgetCategory) continue`) — not an error.
function ProposalBudgetMappingTab() {
  const [categories, setCategories] = useState([])
  const [budgetCats, setBudgetCats] = useState([])
  const [mapping, setMapping] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingCat, setSavingCat] = useState('')
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [showAddBudgetCat, setShowAddBudgetCat] = useState(false)
  const [newCategory, setNewCategory] = useState({ name: '', budgetCategory: '' })
  const [newBudgetLabel, setNewBudgetLabel] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [cats, map, bcats] = await Promise.all([listAllProposalCategories(), getBudgetCategoryMap(), listBudgetCategories()])
    setCategories(cats)
    setMapping(map)
    setBudgetCats(bcats)
    setLoading(false)
  }

  async function setMappingFor(category, budgetCategory) {
    setSavingCat(category)
    try {
      if (budgetCategory) {
        await upsertBudgetCategoryMapping(category, budgetCategory)
        setMapping(m => ({ ...m, [category]: budgetCategory }))
      } else {
        await deleteBudgetCategoryMapping(category)
        setMapping(m => { const n = { ...m }; delete n[category]; return n })
      }
    } finally { setSavingCat('') }
  }

  async function submitNewCategory() {
    const name = newCategory.name.trim()
    if (!name) { setErr('Category name is required'); return }
    if (categories.some(c => c.toLowerCase() === name.toLowerCase())) { setErr('That proposal category already exists'); return }
    setErr('')
    try {
      // Pre-registers the mapping before any live proposal uses this
      // category name — the next "+ Add Cost Section" on any proposal
      // will offer it as a quick-pick (see ProposalsPage.jsx's
      // orderedCategories/CUSTOM_CATEGORY_SUGGESTIONS).
      if (newCategory.budgetCategory) await upsertBudgetCategoryMapping(name, newCategory.budgetCategory)
      setCategories(c => [...c, name])
      if (newCategory.budgetCategory) setMapping(m => ({ ...m, [name]: newCategory.budgetCategory }))
      setNewCategory({ name: '', budgetCategory: '' }); setShowAddCategory(false)
    } catch (e) { setErr(e.message) }
  }

  async function submitNewBudgetCategory() {
    const label = newBudgetLabel.trim()
    if (!label) { setErr('Label is required'); return }
    if (budgetCats.some(b => b.label.toLowerCase() === label.toLowerCase())) { setErr('That budget category already exists'); return }
    setErr('')
    try {
      const created = await addBudgetCategory(label)
      setBudgetCats(b => [...b, created])
      setNewBudgetLabel(''); setShowAddBudgetCat(false)
    } catch (e) { setErr(e.message) }
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading...</div>

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Proposal Budget Mapping</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>
        Every Proposal cost category — standard and custom (from "+ Add Cost Section") — and which planned-budget bucket
        its cost rolls up into when a proposal is converted to a project. A category left "Not mapped" simply won't seed
        a planned-budget line on conversion. Both proposal categories and budget categories can be created here.
      </p>
      {err && <Alert type="danger" message={err} />}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setShowAddCategory(v => !v)}><Plus size={13} /> Add Proposal Category</button>
        <button className="btn btn-outline btn-sm" onClick={() => setShowAddBudgetCat(v => !v)}><Plus size={13} /> Add Budget Category</button>
      </div>

      {showAddCategory && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: 12, background: 'var(--surface-2, #f8fafc)', borderRadius: 10, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 4 }}>New Proposal Category Name</label>
            <input className="form-input" value={newCategory.name} onChange={e => setNewCategory(c => ({ ...c, name: e.target.value }))} placeholder="e.g. IoT Logger" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Budget Category (optional)</label>
            <select className="form-input" style={{ minWidth: 200 }} value={newCategory.budgetCategory} onChange={e => setNewCategory(c => ({ ...c, budgetCategory: e.target.value }))}>
              <option value="">— Not mapped —</option>
              {budgetCats.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button className="btn btn-primary btn-sm" onClick={submitNewCategory}>Add</button>
          <button className="btn btn-outline btn-sm" onClick={() => { setShowAddCategory(false); setErr('') }}>Cancel</button>
        </div>
      )}

      {showAddBudgetCat && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: 12, background: 'var(--surface-2, #f8fafc)', borderRadius: 10, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 4 }}>New Budget Category Label</label>
            <input className="form-input" value={newBudgetLabel} onChange={e => setNewBudgetLabel(e.target.value)} placeholder="e.g. IoT Hardware" />
          </div>
          <button className="btn btn-primary btn-sm" onClick={submitNewBudgetCategory}>Add</button>
          <button className="btn btn-outline btn-sm" onClick={() => { setShowAddBudgetCat(false); setErr('') }}>Cancel</button>
        </div>
      )}

      <table className="data-table">
        <thead><tr><th>Proposal Category</th><th>Type</th><th>Budget Category</th></tr></thead>
        <tbody>
          {categories.map(cat => {
            const isStandard = PROPOSAL_CATEGORIES.includes(cat)
            return (
              <tr key={cat}>
                <td style={{ fontWeight: 600 }}>{cat}</td>
                <td>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: isStandard ? 'var(--ink-muted)' : 'var(--c1)', border: `1px solid ${isStandard ? 'var(--border)' : 'var(--c1)'}`, borderRadius: 4, padding: '1px 6px' }}>
                    {isStandard ? 'Standard' : 'Custom'}
                  </span>
                </td>
                <td>
                  <select className="form-input" style={{ maxWidth: 240 }} disabled={savingCat === cat}
                    value={mapping[cat] || ''} onChange={e => setMappingFor(cat, e.target.value || null)}>
                    <option value="">— Not mapped —</option>
                    {budgetCats.map(o => <option key={o.value} value={o.value}>{o.label}{o.is_custom ? ' (custom)' : ''}</option>)}
                  </select>
                </td>
              </tr>
            )
          })}
          {categories.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: 20 }}>No proposal categories found yet.</td></tr>}
        </tbody>
      </table>
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
  const [emailing, setEmailing] = useState(null) // { id, email, name, busy, sent }

  useEffect(() => { load() }, [])

  async function emailInvite(e) {
    e.preventDefault()
    if (!isValidEmail(emailing.email)) { setErr('Enter a valid email address'); return }
    setErr(''); setEmailing(x => ({ ...x, busy: true }))
    try { await sendInviteEmail(emailing.id, emailing.email, emailing.name); setEmailing(x => ({ ...x, busy: false, sent: x.email })) }
    catch (e2) { setErr(e2.message); setEmailing(x => ({ ...x, busy: false })) }
  }

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
              return [
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
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{!inactive && <>
                    <button className="btn btn-ghost btn-sm" title="Email this invite" onClick={() => setEmailing(emailing?.id === i.id ? null : { id: i.id, email: '', name: '' })}><Mail size={12} /> Email</button>{' '}
                    <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => handleRevoke(i.id)}><Trash2 size={12} /></button>
                  </>}</td>
                </tr>,
                emailing?.id === i.id && (
                  <tr key={i.id + '-email'}><td colSpan={6} style={{ background: '#f8fafc' }}>
                    {emailing.sent ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                        <CheckCircle2 size={14} style={{ color: '#15803d' }} /> Invite emailed to <b>{emailing.sent}</b>.
                        <button className="btn btn-ghost btn-sm" onClick={() => setEmailing({ id: i.id, email: '', name: '' })}>Send another</button>
                      </div>
                    ) : (
                      <form onSubmit={emailInvite} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <input className="form-input" style={{ width: 240 }} type="email" autoFocus required placeholder="teammate@company.com" value={emailing.email} onChange={e => setEmailing(x => ({ ...x, email: e.target.value }))} />
                        <input className="form-input" style={{ width: 180 }} placeholder="Name (optional)" value={emailing.name} onChange={e => setEmailing(x => ({ ...x, name: e.target.value }))} />
                        <button className="btn btn-primary btn-sm" type="submit" disabled={emailing.busy}>{emailing.busy ? 'Sending…' : 'Send invite'}</button>
                        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Needs email turned on in Settings → Email.</span>
                      </form>
                    )}
                  </td></tr>
                ),
              ]
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
  const [query, setQuery] = useState('')
  const [openCats, setOpenCats] = useState(new Set())
  const [catBusy, setCatBusy] = useState(null) // `${category}:${roleKey}` while a bulk toggle is in flight

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [perms, rolePerms, roleList] = await Promise.all([listPermissions(), listRolePermissions(), listRoles()])
      setPermissions(perms)
      setRoles(roleList)
      setGranted(new Set(rolePerms.map(rp => `${rp.role_key}:${rp.permission_key}`)))
      setOpenCats(new Set([perms[0]?.category].filter(Boolean)))
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  // Everyone except the locked role — the grid columns/counts that are
  // actually meaningful to edit (mirrors gridRoles in RolesModulesTab).
  const gridRoles = useMemo(() => roles.filter(r => r.role_key !== PERMISSION_LOCKED_ROLE), [roles])

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

  // Grant/revoke every permission in a category at once for one role —
  // e.g. give `manager` all of "Performance" in one click instead of
  // ticking each row. Writes sequentially (a category is a handful of
  // rows at most), same pattern as setSectionEnabled() above.
  async function toggleCategoryForRole(category, roleKey, perms) {
    const allGranted = perms.every(p => granted.has(`${roleKey}:${p.key}`))
    const next = !allGranted
    setCatBusy(`${category}:${roleKey}`); setErr('')
    try {
      for (const p of perms) {
        const key = `${roleKey}:${p.key}`
        if (granted.has(key) === next) continue
        await setRolePermission(roleKey, p.key, next)
      }
      setGranted(g => {
        const s = new Set(g)
        perms.forEach(p => { const key = `${roleKey}:${p.key}`; next ? s.add(key) : s.delete(key) })
        return s
      })
    } catch (e) { setErr(e.message) }
    finally { setCatBusy(null) }
  }

  function toggleCat(cat) {
    setOpenCats(prev => { const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next })
  }

  if (loading) return <Loader />

  const totalGrants = gridRoles.length * permissions.length
  const activeGrants = permissions.reduce((sum, p) => sum + gridRoles.filter(r => granted.has(`${r.role_key}:${p.key}`)).length, 0)

  const q = query.trim().toLowerCase()
  const categories = [...new Set(permissions.map(p => p.category))]
  const catsData = categories.map(cat => {
    const perms = permissions.filter(p => p.category === cat)
    const shown = q ? perms.filter(p => p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q) || cat.toLowerCase().includes(q)) : perms
    const grantedCount = perms.reduce((sum, p) => sum + gridRoles.filter(r => granted.has(`${r.role_key}:${p.key}`)).length, 0)
    return { cat, perms, shown, grantedCount, total: perms.length * gridRoles.length }
  }).filter(c => c.shown.length > 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Permissions</h3>
          <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', maxWidth: 640 }}>
            Which roles can perform which actions, independent of the Roles &amp; Modules tab's nav visibility. Changes apply immediately, platform-wide (roles aren't per-organization).
          </p>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 999, padding: '5px 12px', whiteSpace: 'nowrap' }}>
          {activeGrants} / {totalGrants} grants
        </span>
      </div>

      <div style={{ maxWidth: 320, marginBottom: 14 }}>
        <SearchBox value={query} onChange={setQuery} placeholder="Search permissions..." />
      </div>

      {err && <Alert type="error" message={err} />}

      {catsData.length === 0 ? (
        <Empty icon={<Key size={40} />} title="No permissions match" desc={`Nothing matches "${query.trim()}".`} />
      ) : (
        <div>
          {catsData.map(({ cat, shown, grantedCount, total }) => {
            const isOpen = q ? true : openCats.has(cat)
            return (
              <div key={cat} className="mod-section">
                <button type="button" className="mod-section-head" style={{ width: '100%', border: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleCat(cat)}>
                  {isOpen ? <ChevronDown size={14} className="mod-caret" /> : <ChevronRight size={14} className="mod-caret" />}
                  <span className="mod-section-name">{cat}</span>
                  <span className="mod-section-count">{grantedCount}/{total} granted</span>
                </button>
                {isOpen && shown.map(p => (
                  <div key={p.key} className="mod-row">
                    <div className="mod-row-main" style={{ flexBasis: 220 }}>
                      <div>
                        <div className="mod-row-label">{p.label}</div>
                        <div className="mod-row-key">{p.key}</div>
                      </div>
                    </div>
                    <div className="mod-roles">
                      {gridRoles.map(r => {
                        const isChecked = granted.has(`${r.role_key}:${p.key}`)
                        const color = colorForRole(r.color || r.role_key)
                        return (
                          <button key={r.role_key} type="button"
                            className={`chip-toggle ${isChecked ? 'on' : ''}`}
                            style={isChecked ? { background: color, borderColor: color } : { color }}
                            title={isChecked ? `${r.label} has this permission — click to revoke` : `Grant to ${r.label}`}
                            onClick={() => toggle(r.role_key, p.key)}>
                            {isChecked ? <Check size={11} /> : <X size={11} />} {r.label}
                          </button>
                        )
                      })}
                      <span className="chip-toggle on" style={{ cursor: 'not-allowed', opacity: .6 }} title="Admin/CEO always has every permission">
                        <Lock size={11} /> Admin
                      </span>
                    </div>
                  </div>
                ))}
                {isOpen && gridRoles.length > 0 && (
                  <div className="mod-row" style={{ background: 'var(--surface)' }}>
                    <div className="mod-row-main" style={{ flexBasis: 220 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>Grant all in {cat}</span>
                    </div>
                    <div className="mod-roles">
                      {gridRoles.map(r => {
                        const perms = permissions.filter(p => p.category === cat)
                        const allGranted = perms.every(p => granted.has(`${r.role_key}:${p.key}`))
                        const busy = catBusy === `${cat}:${r.role_key}`
                        return (
                          <button key={r.role_key} type="button" className="btn btn-ghost btn-sm" disabled={busy}
                            onClick={() => toggleCategoryForRole(cat, r.role_key, perms)}>
                            {busy ? '…' : allGranted ? `Revoke all — ${r.label}` : `Grant all — ${r.label}`}
                          </button>
                        )
                      })}
                    </div>
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

// ── Mobile App (STEP161/163/165) ──
// Per-org control over which mobile-capable modules appear in the Expo
// app, plus the "enforce per-user allocation" switch and an effective-
// access preview. Capability (does a mobile screen exist) is code-owned
// via mobile_module_capable_keys(); this tab only sets preferences.
function MobileAppTab() {
  const { profile } = useAuth()
  const orgId = profile.organization_id
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const [capable, setCapable] = useState([])
  const [cfg, setCfg] = useState([])
  const [roles, setRoles] = useState([])
  const [users, setUsers] = useState([])
  const [enforce, setEnforce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [impact, setImpact] = useState(null)
  const [confirmEnforce, setConfirmEnforce] = useState(false)

  const [pvUser, setPvUser] = useState('')
  const [pvPlatform, setPvPlatform] = useState('mobile')
  const [pvRows, setPvRows] = useState(null)
  const [pvBusy, setPvBusy] = useState(false)

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true); setErr('')
    try {
      const [keys, rows, r, enf, u] = await Promise.all([
        getMobileCapableKeys(),
        getMobileModuleConfig(orgId),
        listRoles(),
        getAllocationEnforcement(orgId),
        supabase.from('profiles').select('id, full_name, role').eq('organization_id', orgId).order('full_name'),
      ])
      setCapable(keys); setCfg(rows); setRoles(r); setEnforce(enf); setUsers(u.data || [])
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  const cfgByKey = useMemo(() => Object.fromEntries(cfg.map(c => [c.module_key, c])), [cfg])
  const capableSet = useMemo(() => new Set(capable), [capable])
  const sections = useMemo(
    () => MODULE_SECTIONS
      .map(s => ({ section: s, mods: MODULES.filter(m => m.section === s && capableSet.has(m.key)) }))
      .filter(x => x.mods.length > 0),
    [capableSet],
  )
  const roleOptions = roles.filter(r => !['admin', 'ceo'].includes(r.role_key))

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  function patchCfg(key, fields) {
    setCfg(prev => {
      const i = prev.findIndex(c => c.module_key === key)
      if (i >= 0) { const n = [...prev]; n[i] = { ...n[i], ...fields }; return n }
      return [...prev, { organization_id: orgId, module_key: key, is_enabled: true, min_role: null, ...fields }]
    })
  }

  async function toggleShow(key) {
    const next = !(cfgByKey[key]?.is_enabled ?? true)
    try { await setMobileModuleConfig(orgId, key, { is_enabled: next }, profile.id); patchCfg(key, { is_enabled: next }) }
    catch (e) { setErr(e.message) }
  }
  async function setMinRole(key, min_role) {
    try { await setMobileModuleConfig(orgId, key, { min_role: min_role || null }, profile.id); patchCfg(key, { min_role: min_role || null }) }
    catch (e) { setErr(e.message) }
  }

  async function onEnforceToggle() {
    setBusy(true); setErr('')
    try {
      if (enforce) { await setAllocationEnforcement(false); setEnforce(false); flash('Allocation enforcement turned off') }
      else { setImpact(await previewAllocationImpact()); setConfirmEnforce(true) }
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }
  async function confirmEnable() {
    setBusy(true)
    try {
      await setAllocationEnforcement(true)
      setEnforce(true); setConfirmEnforce(false); setImpact(null)
      flash('Enforcement on — existing members were backfilled')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }
  async function runBackfill() {
    setBusy(true)
    try { const n = await backfillAllocations(); flash(`${n} allocation row(s) added`) }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }
  async function runPreview() {
    if (!pvUser) return
    setPvBusy(true); setErr('')
    try { setPvRows(await effectiveModulesFor(pvUser, pvPlatform)) }
    catch (e) { setErr(e.message) }
    finally { setPvBusy(false) }
  }

  if (loading) return <Loader />

  const h3 = { fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }
  const sub = { color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 14, maxWidth: 640 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {err && <Alert type="error" message={err} />}
      {msg && <Alert type="success" message={msg} />}

      {/* 1 — module availability on mobile */}
      <div>
        <h3 style={h3}>Module availability on mobile</h3>
        <p style={sub}>Only modules that already have a mobile screen appear here. Turn one off to hide it in the app, or set a minimum role. Absence of an override = shown to everyone the web rules already allow.</p>
        {sections.length === 0
          ? <Empty icon={<Smartphone size={40} />} title="No mobile modules yet" desc="Nothing has a mobile screen registered." />
          : sections.map(({ section, mods }) => (
            <div key={section} className="mod-section">
              <div className="mod-section-head"><span className="mod-section-name">{section}</span></div>
              {mods.map(m => {
                const c = cfgByKey[m.key]
                const shown = c?.is_enabled ?? true
                return (
                  <div key={m.key} className="mod-row" style={{ opacity: shown ? 1 : 0.6 }}>
                    <div className="mod-row-main">
                      <Toggle checked={shown} onChange={() => toggleShow(m.key)} label={shown ? 'Shown' : 'Hidden'} />
                      <div style={{ minWidth: 0 }}>
                        <div className="mod-row-label">{m.label}</div>
                        <div className="mod-row-key">{m.key}</div>
                      </div>
                    </div>
                    <div className="mod-roles">
                      <span style={{ fontSize: 11.5, color: 'var(--ink-muted)', fontWeight: 700 }}>Min role</span>
                      <select className="form-input" style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                        value={c?.min_role || ''} disabled={!shown}
                        onChange={e => setMinRole(m.key, e.target.value)}>
                        <option value="">Anyone</option>
                        {roleOptions.map(r => <option key={r.role_key} value={r.role_key}>{r.label} &amp; above</option>)}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
      </div>

      {/* 2 — allocation enforcement */}
      <div>
        <h3 style={h3}>Per-user module allocation</h3>
        <p style={sub}>While ON, a non-admin user is denied a paid module unless they hold a seat allocation for its bundle — on web <strong>and</strong> mobile. Admin/CEO and Enterprise plans always bypass. Turning it on backfills every active member × active bundle first, so nobody loses access.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', flexWrap: 'wrap' }}>
          <Toggle checked={enforce} disabled={busy} onChange={onEnforceToggle} label={enforce ? 'Enforcing' : 'Off'} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{enforce ? 'Enforcement is ON' : 'Enforcement is OFF'}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Allocations are managed per bundle in the Billing tab.</div>
          </div>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={runBackfill}>Run backfill now</button>
        </div>
      </div>

      {/* 3 — effective-access preview */}
      <div>
        <h3 style={h3}>Effective access preview</h3>
        <p style={sub}>See exactly which modules a user gets, and the reason for anything hidden.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <select className="form-input" style={{ width: 'auto' }} value={pvUser} onChange={e => { setPvUser(e.target.value); setPvRows(null) }}>
            <option value="">Select a user…</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name} · {u.role}</option>)}
          </select>
          <select className="form-input" style={{ width: 'auto' }} value={pvPlatform} onChange={e => { setPvPlatform(e.target.value); setPvRows(null) }}>
            <option value="mobile">Mobile</option>
            <option value="web">Web</option>
          </select>
          <button className="btn btn-primary btn-sm" disabled={!pvUser || pvBusy} onClick={runPreview}>{pvBusy ? 'Loading…' : 'Preview'}</button>
        </div>
        {pvRows && (
          <div className="mod-section">
            {pvRows.map(r => (
              <div key={r.module_key} className="mod-row" style={{ opacity: r.allowed ? 1 : 0.6 }}>
                <div className="mod-row-main">
                  {r.allowed ? <Check size={15} style={{ color: 'var(--success)' }} /> : <Lock size={14} style={{ color: 'var(--ink-muted)' }} />}
                  <div style={{ minWidth: 0 }}>
                    <div className="mod-row-label">{r.label}</div>
                    <div className="mod-row-key">{r.module_key} · {r.source}</div>
                  </div>
                </div>
                <div className="mod-roles">
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: r.allowed ? 'var(--success)' : 'var(--ink-muted)' }}>
                    {MOBILE_REASON_LABEL[r.reason] || r.reason}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Confirm open={confirmEnforce} danger
        message={impact && impact.length
          ? `${impact.length} (user, module bundle) pair(s) have no allocation today. Enabling will BACKFILL all of them first so nobody loses access, then enforce going forward. Continue?`
          : 'Every current member gets backfilled, then enforcement turns on. Continue?'}
        onConfirm={confirmEnable}
        onCancel={() => { setConfirmEnforce(false); setImpact(null) }} />
    </div>
  )
}

const TABS = [
  { id: 'organization', label: 'Organization', icon: <Building2 size={15} />, group: 'general', description: "Your organization's name, branding and workspace details" },
  { id: 'roles-modules', label: 'Roles & Modules', icon: <Shield size={15} />, group: 'general', description: 'Control which modules are visible to each role, org-wide' },
  { id: 'permissions', label: 'Permissions', icon: <Key size={15} />, group: 'general', description: 'Fine-grained action permissions per role, e.g. who can approve or grant an award' },
  { id: 'departments', label: 'Departments', icon: <Building2 size={15} />, group: 'general', description: 'Add, rename or remove departments in your organization' },
  { id: 'locations', label: 'Locations', icon: <MapPin size={15} />, group: 'general', description: 'Sites, plants, stores, warehouses or any place work happens' },
  { id: 'teams', label: 'Teams', icon: <Users size={15} />, group: 'general', description: 'Crews, squads or working groups, independent of departments' },
  { id: 'shifts', label: 'Shifts', icon: <Clock size={15} />, group: 'general', description: 'Shift patterns and who is assigned to them' },
  { id: 'workspace', label: 'Workspace', icon: <Layers size={15} />, group: 'general', description: 'Industry, business type, modules and dashboard — how this organization is configured' },
  { id: 'task-templates', label: 'Task Templates', icon: <ClipboardList size={15} />, group: 'general', description: 'Reusable task presets with checklists, applied from Work Items' },
  { id: 'task-field-rules', label: 'Task Field Rules', icon: <ListChecks size={15} />, group: 'general', description: 'Which fields on the Task form are required — separately for create and edit' },
  { id: 'task-view', label: 'Task Detail View', icon: <Sliders size={15} />, group: 'general', description: 'Modal or right-side drawer — how a task opens when clicked in Task Management' },
  { id: 'work-types', label: 'Work Types', icon: <Puzzle size={15} />, group: 'general', description: 'The types available when creating a Work Order or other non-Project work item' },
  { id: 'status-flows', label: 'Task Status Flows', icon: <GitBranch size={15} />, group: 'general', description: 'Each department gets its own status pipeline for Task Management (e.g. Application: Backlog/Todo/Analysis; Firmware: Backlog/POC/Pilot/Test)' },
  { id: 'onboarding-tour', label: 'Onboarding & Tour', icon: <Compass size={15} />, group: 'general', description: 'First-run walkthrough slides and the in-app guided tour, for web and mobile' },
  { id: 'billing', label: 'Billing', icon: <CreditCard size={15} />, group: 'general', description: 'Plan, seats, and à-la-carte module add-ons' },
  { id: 'email', label: 'Email', icon: <Mail size={15} />, group: 'general', description: 'Sender name, scheduled report emails and the delivery log' },
  { id: 'outlook-email', label: 'Outlook Email', icon: <MailCheck size={15} />, group: 'general', description: 'Turn customer emails in an Outlook mailbox into project action items (Microsoft Graph)' },
  { id: 'mobile-app', label: 'Mobile App', icon: <Smartphone size={15} />, group: 'general', description: 'Which modules appear in the mobile app, and per-user allocation enforcement' },
  { id: 'approval', label: 'Approval Chain', icon: <GitBranch size={15} />, group: 'finance', description: 'Configure multi-step approval chains per workflow and role' },
  { id: 'budget', label: 'Budget Config', icon: <DollarSign size={15} />, group: 'finance', description: 'Department and project budget thresholds' },
  { id: 'proposal-budget-mapping', label: 'Proposal Budget Mapping', icon: <GitBranch size={15} />, group: 'finance', description: 'Which planned-budget bucket each Proposal cost category (standard or custom) rolls up into on Convert to Project' },
  { id: 'categories', label: 'Expense Categories', icon: <Tag size={15} />, group: 'finance', description: 'Manage the expense category list' },
  { id: 'gst', label: 'GST Settings', icon: <FileText size={15} />, group: 'finance', description: 'Company GST details and tax configuration' },
  { id: 'document-templates', label: 'Document Templates', icon: <LayoutTemplate size={15} />, group: 'finance', description: 'Design PDF letterheads for invoices, GRNs, warranties and proposals' },
  { id: 'ai-keys', label: 'AI / LLM Keys', icon: <Sparkles size={15} />, group: 'ai', description: 'API keys for DeepSeek and Gemini used by Neo Task AI' },
  { id: 'email-intelligence', label: 'Email Intelligence', icon: <MailCheck size={15} />, group: 'ai', description: 'Email categories, keywords, document types, PO/GRN/invoice matching and AI settings for incoming email — versioned, with test and rollback' },
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
            {activeTab === 'mobile-app' && <MobileAppTab />}
            {activeTab === 'email' && <EmailSettingsTab />}
            {activeTab === 'outlook-email' && <OutlookSettings />}
            {activeTab === 'email-intelligence' && <EmailIntelligenceSettings />}
            {activeTab === 'approval' && <ApprovalChainTab />}
            {activeTab === 'departments' && <DepartmentsTab />}
            {activeTab === 'locations' && <LocationsTab />}
            {activeTab === 'teams' && <TeamsTab />}
            {activeTab === 'shifts' && <ShiftsTab />}
            {activeTab === 'workspace' && <WorkspaceTab />}
            {activeTab === 'task-templates' && <TaskTemplatesTab />}
            {activeTab === 'task-field-rules' && <TaskFieldRulesTab />}
            {activeTab === 'task-view' && <TaskViewSettingsTab />}
            {activeTab === 'work-types' && <WorkTypesTab />}
            {activeTab === 'status-flows' && <StatusFlowsTab />}
            {activeTab === 'onboarding-tour' && <OnboardingTourTab />}
            {activeTab === 'budget' && <BudgetConfigTab />}
            {activeTab === 'proposal-budget-mapping' && <ProposalBudgetMappingTab />}
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
