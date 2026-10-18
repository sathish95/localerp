import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt, rupee } from '../lib/supabase'
import { createDeviceWarranty, computeDeviceAgeMonths, computeWarrantyWindow } from '../lib/warranty'
import { Modal, SearchBox, Loader, Empty, Confirm } from '../components/ui'
import ExcelImport, { TEMPLATES } from '../components/ui/ExcelImport'
import { ensureXLSX } from '../lib/xlsxLoader'
import { Plus, Edit2, Trash2, ArrowRightLeft, History, Clock, ShieldCheck, Upload, Download, Radio, Cpu, List, Grid3x3, Eye } from 'lucide-react'
import { listDeviceSensors, applyDefaultSensors, isMissingSetup, listSensorTypes, listSensorDefaults, SENSOR_KINDS, kindOf, fetchAllRows } from '../lib/deviceMaster'
import {
  FirmwareBadge, FirmwareSelect, FirmwareReleasesModal, useFirmwareReleases, SensorSummary, SensorCatalogModal, DeviceSensorsModal,
  DeviceTasksPanel, FirmwareUpgradeModal, DeviceSensorSlots, BulkSensorModal,
} from '../components/devices/DeviceParts'
import { Kpi } from '../components/golive/shared'
import { getActiveBomEdges } from '../lib/bom'
import { firmwareState } from '../lib/deviceMaster'
import { CheckInHereButton, DeviceVisitsPanel } from '../components/devices/VisitParts'
import { SENSOR_HEALTH } from '../lib/deviceMaster'

const STATUSES = ['deployed', 'in_storage', 'faulty', 'replaced', 'decommissioned']
const SL = { deployed: 'Deployed', in_storage: 'In Storage', faulty: 'Faulty', replaced: 'Replaced', decommissioned: 'Decommissioned' }
const SC = { deployed: '#10b981', in_storage: '#3b82f6', faulty: '#e11d48', replaced: '#f59e0b', decommissioned: '#94a3b8' }
const Pill = ({ status }) => <span style={{ padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${SC[status]}18`, color: SC[status], border: `1px solid ${SC[status]}30`, whiteSpace: 'nowrap' }}>{SL[status] || status}</span>

const initForm = () => ({
  part_number: '', serial_number: '', customer_id: '', project_id: '', status: 'in_storage',
  installed_date: '', warranty_start: '', warranty_end: '', warranty_policy_id: '', current_location: '', assigned_to: '', notes: '',
  equipment_id: '', equipment_name: '', equipment_category: '',
})

const isWarrantyNear = d => {
  if (!d) return false
  const days = (new Date(d) - new Date()) / 86400000
  return days >= 0 && days <= 30
}

// Mirrors src/lib/warranty.js's getClaimPercentageForAge, but takes an
// already-loaded tiers array instead of making a DB round-trip per row —
// this page needs the age-adjusted claim % for every device in the table
// at once, not one at a time.
function claimPctFromTiers(tiers, ageMonths) {
  if (!tiers?.length) return 100
  const match = tiers.find(t => ageMonths >= Number(t.min_age_months) && (t.max_age_months == null || ageMonths < Number(t.max_age_months)))
  return match ? Number(match.claim_percentage) : 0
}

export default function DevicesPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [devices, setDevices] = useState([])
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [policies, setPolicies] = useState([])
  const [depreciationTiers, setDepreciationTiers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [showMove, setShowMove] = useState(null)
  const [moveForm, setMoveForm] = useState({ to_project_id: '', to_customer_id: '', to_status: 'deployed', warranty_policy_id: '', reason: '' })
  const [showHistory, setShowHistory] = useState(null)
  const [projectFilter, setProjectFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [sensorFilter, setSensorFilter] = useState('') // '' | has:<type> | no:<type> | down | unreviewed | none
  const [view, setView] = useState('list')
  const [sensors, setSensors] = useState([])
  const [sensorNote, setSensorNote] = useState('')
  const [firmwareOpen, setFirmwareOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [sensorsFor, setSensorsFor] = useState(null)
  const [upgradeFor, setUpgradeFor] = useState(null)
  const [tasksKey, setTasksKey] = useState(0)
  const [picked, setPicked] = useState(new Set())
  const [bulkSensor, setBulkSensor] = useState(null) // 'add' | 'remove'
  const togglePick = id => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const { releases, reload: reloadReleases } = useFirmwareReleases()
  const [bom, setBom] = useState([])
  const [partNames, setPartNames] = useState({})
  const [detailTab, setDetailTab] = useState('sensors')
  const [sensorTypes, setSensorTypes] = useState([])
  const [sensorDefaults, setSensorDefaults] = useState([])
  useEffect(() => { listSensorDefaults().then(setSensorDefaults).catch(() => setSensorDefaults([])) }, [catalogOpen])
  useEffect(() => { listSensorTypes().then(setSensorTypes).catch(() => setSensorTypes([])) }, [catalogOpen])
  const [kpi, setKpi] = useState('')
  useEffect(() => {
    getActiveBomEdges().then(setBom).catch(() => setBom([]))
    supabase.from('products').select('part_number,name').then(({ data }) => setPartNames(Object.fromEntries((data || []).map(p => [p.part_number, p.name]))))
  }, [])
  // direct components of each product's active BOM
  const bomOf = useMemo(() => bom.reduce((m, e) => ((m[e.parent_part_number] ||= []).push(e), m), {}), [bom])
  const componentUnits = partNumber => (bomOf[partNumber] || []).reduce((n, e) => n + Number(e.quantity || 0), 0)
  const loadSensors = () => listDeviceSensors().then(r => { setSensors(r); setSensorNote('') }).catch(e => setSensorNote(isMissingSetup(e) ? 'Sensor mapping needs sql/STEP243_device_sensors.sql — run it in the Supabase SQL Editor.' : e.message))
  useEffect(() => { loadSensors() }, [])
  const sensorsOf = useMemo(() => sensors.reduce((m, r) => ((m[r.device_id] ||= []).push(r), m), {}), [sensors])
  const [history, setHistory] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [err, setErr] = useState('')

  const role = profile?.role || 'employee'
  const canEdit = ['admin', 'ceo', 'manager', 'department_head', 'procurement_lead', 'pm'].includes(role)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    // device_instances.part_number/customer_id/project_id are all soft refs
    // (no REFERENCES constraint, per STEP25's design) — PostgREST embedding
    // (`product:products(...)`) can't resolve those, so devices are fetched
    // plain and joined to products/customers/projects client-side below via
    // productByPart/customerById/projectById.
    const [dR, pR, cR, prR, uR, polR, tierR] = await Promise.all([
      fetchAllRows(() => supabase.from('device_instances').select('*').order('created_at', { ascending: false })).then(data => ({ data })),
      supabase.from('products').select('part_number,name,standard_cost,warranty_months').eq('is_serialized', true).eq('status', 'active').order('name'),
      supabase.from('customers').select('id,name').order('name'),
      supabase.from('projects').select('id,name,code').order('name'),
      supabase.from('profiles').select('id,full_name').order('full_name'),
      supabase.from('warranty_policies').select('*').eq('is_active', true),
      supabase.from('warranty_depreciation_tiers').select('*'),
    ])
    setDevices(dR.data || []); setProducts(pR.data || []); setCustomers(cR.data || [])
    setProjects(prR.data || []); setUsers(uR.data || [])
    setPolicies(polR.data || []); setDepreciationTiers(tierR.data || [])
    setLoading(false)
  }

  // Product register applying its Warranty Policy: for each device, resolve
  // the policy for its part_number, compute the device's age from its
  // warranty start date, and price the claim value as standard_cost x the
  // policy's age-based depreciation % (100% if no policy/tiers configured).
  const policyByPart = useMemo(() => Object.fromEntries(policies.map(p => [p.part_number, p])), [policies])
  const productByPart = useMemo(() => Object.fromEntries(products.map(p => [p.part_number, p])), [products])
  const customerById = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c])), [customers])
  const projectById = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects])
  const tiersByPolicy = useMemo(() => {
    const m = {}
    depreciationTiers.forEach(t => { (m[t.warranty_policy_id] ||= []).push(t) })
    return m
  }, [depreciationTiers])

  function ageAndClaimFor(d) {
    if (!d.warranty_start) return { ageMonths: null, claimPct: null, claimValue: null }
    const ageMonths = computeDeviceAgeMonths(d.warranty_start)
    const policy = policyByPart[d.part_number]
    const standardCost = Number(productByPart[d.part_number]?.standard_cost || 0)
    const tiers = policy ? tiersByPolicy[policy.id] : null
    const claimPct = claimPctFromTiers(tiers, ageMonths)
    return { ageMonths, claimPct, claimValue: Math.round(standardCost * (claimPct / 100) * 100) / 100 }
  }

  const policyById = useMemo(() => Object.fromEntries(policies.map(p => [p.id, p])), [policies])
  function durationForPolicy(policyId, partNumber) {
    return policyById[policyId]?.warranty_duration_months || productByPart[partNumber]?.warranty_months || 12
  }

  // Installation date -> automatic warranty window: whenever the install
  // date (or the selected product/policy) changes, recompute Warranty
  // Start/End from installed_date + the policy's duration (default 12mo)
  // so a new device always gets a warranty period without extra steps.
  function applyInstallDate(f, installedDate) {
    if (!installedDate) return { ...f, installed_date: installedDate }
    const { warrantyStart, warrantyEnd } = computeWarrantyWindow(installedDate, durationForPolicy(f.warranty_policy_id, f.part_number))
    return { ...f, installed_date: installedDate, warranty_start: warrantyStart, warranty_end: warrantyEnd }
  }
  function applyPartNumber(f, partNumber) {
    const policyId = policyByPart[partNumber]?.id || ''
    const next = { ...f, part_number: partNumber, warranty_policy_id: policyId }
    return f.installed_date ? applyInstallDate(next, f.installed_date) : next
  }
  function applyPolicy(f, policyId) {
    const next = { ...f, warranty_policy_id: policyId }
    return f.installed_date ? applyInstallDate(next, f.installed_date) : next
  }

  function openCreate() { setEditing(null); setForm(initForm()); setErr(''); setShowModal(true) }
  function openEdit(d) { setEditing(d); setForm({ ...initForm(), ...d, warranty_policy_id: policyByPart[d.part_number]?.id || '' }); setErr(''); setShowModal(true) }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true); setErr('')
    try {
      const { part_number, serial_number, customer_id, project_id, status, installed_date, warranty_start, warranty_end, warranty_policy_id, current_location, assigned_to, notes, equipment_id, equipment_name, equipment_category } = form
      const payload = {
        part_number: part_number || null, serial_number, customer_id: customer_id || null, project_id: project_id || null,
        status, installed_date: installed_date || null, warranty_start: warranty_start || null, warranty_end: warranty_end || null,
        current_location: current_location || null, assigned_to: assigned_to || null, notes: notes || null,
        equipment_id: equipment_id?.trim() || null, equipment_name: equipment_name?.trim() || null,
        ...(form.firmware_version || editing?.firmware_version ? { firmware_version: form.firmware_version?.trim() || null } : {}), equipment_category: equipment_category?.trim() || null,
      }
      if (editing) {
        const { error } = await supabase.from('device_instances').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const device_code = 'DEV-' + Date.now().toString().slice(-6)
        // Plain insert, no .select() chained — the device's save must
        // succeed and show up regardless of whether a select-back of the
        // fresh row (RLS timing, etc.) works. Warranty activation below is
        // a strictly best-effort follow-up that can never block this.
        const { error } = await supabase.from('device_instances').insert({ ...payload, device_code, created_by: profile.id })
        if (error) throw error
        // Installation date present at registration -> the warranty clock
        // starts immediately (12mo by default, or the applied policy's
        // duration), same as the Move/Redeploy flow's Workflow A — a new
        // device never sits untracked just because it wasn't deployed
        // through the Move dialog.
        if (installed_date) {
          try {
            const { data: created } = await supabase.from('device_instances').select('id').eq('device_code', device_code).maybeSingle()
            if (created?.id) {
              await createDeviceWarranty({
                deviceId: created.id, deploymentDate: installed_date, projectId: project_id || null,
                policyId: warranty_policy_id || null, profileId: profile.id,
              })
            }
          } catch (e) { console.error('Warranty activation failed:', e) }
        }
      }
      setShowModal(false); load()
    } catch (e) { setErr(e.message) }
    finally { setSubmitting(false) }
  }

  async function handleDelete(id) {
    await supabase.from('device_instances').delete().eq('id', id)
    setDeleteConfirm(null); load()
  }

  function openMove(d) {
    setShowMove(d)
    setMoveForm({ to_project_id: d.project_id || '', to_customer_id: d.customer_id || '', to_status: 'deployed', warranty_policy_id: policyByPart[d.part_number]?.id || '', reason: '' })
  }

  async function handleMoveSubmit(e) {
    e.preventDefault()
    if (!moveForm.reason) { alert('A reason for the move is required.'); return }
    setSubmitting(true)
    try {
      const d = showMove
      await supabase.from('deployment_history').insert({
        device_id: d.id, from_project_id: d.project_id || null, to_project_id: moveForm.to_project_id || null,
        from_customer_id: d.customer_id || null, to_customer_id: moveForm.to_customer_id || null,
        from_status: d.status, to_status: moveForm.to_status, moved_by: profile.id, reason: moveForm.reason,
      })
      await supabase.from('device_instances').update({
        project_id: moveForm.to_project_id || null, customer_id: moveForm.to_customer_id || null, status: moveForm.to_status,
      }).eq('id', d.id)
      // Workflow A: auto-activate a warranty clock the moment a device is
      // deployed, so tracking never gets forgotten for a newly deployed unit.
      if (moveForm.to_status === 'deployed') {
        try {
          await createDeviceWarranty({
            deviceId: d.id, deploymentDate: new Date().toISOString().slice(0, 10),
            projectId: moveForm.to_project_id || null, policyId: moveForm.warranty_policy_id || null, profileId: profile.id,
          })
        } catch (e) { console.error('Warranty activation failed:', e) }
      }
      setShowMove(null); load()
    } catch (e) { alert(e.message) }
    finally { setSubmitting(false) }
  }

  async function openHistory(d) {
    setShowHistory(d)
    setDetailTab(t => t || 'sensors')
    const { data } = await supabase.from('deployment_history').select('*, mover:profiles!moved_by(full_name)').eq('device_id', d.id).order('moved_date', { ascending: false })
    setHistory(data || [])
  }

  const deviceSensors = id => (sensors || []).filter(r => r.device_id === id && r.health !== 'REMOVED')
  const fwDue = d => ['OUTDATED', 'DEPRECATED', 'UNLISTED'].includes(firmwareState(releases, d.part_number, d.firmware_version).state)
  function kpiMatch(d) {
    if (!kpi) return true
    if (kpi === 'SENSORS') return deviceSensors(d.id).length > 0
    if (kpi === 'DOWN') return deviceSensors(d.id).some(r => r.health === 'NOT_WORKING' || r.health === 'FAULTY')
    if (kpi === 'FIRMWARE') return fwDue(d)
    if (kpi === 'WARRANTY') return isWarrantyNear(d.warranty_end)
    return true
  }
  // Sensor filter: devices with / without a sensor type, any sensor down, not reviewed, or none mapped
  function sensorMatch(d) {
    if (!sensorFilter) return true
    const mine = deviceSensors(d.id)
    if (sensorFilter === 'down') return mine.some(r => r.health === 'NOT_WORKING' || r.health === 'FAULTY')
    if (sensorFilter === 'unreviewed') return mine.some(r => r.health === 'NOT_REVIEWED')
    if (sensorFilter === 'none') return !mine.length
    if (sensorFilter.startsWith('kind:')) return mine.some(r => kindOf(r, sensorTypes) === sensorFilter.slice(5))
    const [mode, typeId] = sensorFilter.split(':')
    const has = mine.some(r => r.sensor_type_id === typeId)
    return mode === 'has' ? has : !has
  }
  const filtered = useMemo(() => devices.filter(d =>
    (!search || [d.serial_number, d.device_code, productByPart[d.part_number]?.name, d.equipment_id, d.equipment_name, d.equipment_category, d.current_location, d.firmware_version].some(v => v?.toLowerCase().includes(search.toLowerCase()))) &&
    (!statusFilter || d.status === statusFilter) &&
    (!projectFilter || (projectFilter === '__none' ? !d.project_id : d.project_id === projectFilter)) &&
    (!siteFilter || (d.current_location || '') === siteFilter) &&
    sensorMatch(d) &&
    kpiMatch(d)
  ), [devices, search, statusFilter, projectFilter, siteFilter, sensorFilter, productByPart, kpi, sensors, releases])
  const sites = useMemo(() => [...new Set(devices.filter(d => !projectFilter || d.project_id === projectFilter).map(d => d.current_location).filter(Boolean))].sort(), [devices, projectFilter])
  const projectsInUse = useMemo(() => projects.filter(p => devices.some(d => d.project_id === p.id)), [projects, devices])
  // sensor types present on the filtered devices, most common first — the Sensor map's columns
  const mapColumns = useMemo(() => {
    const ids = new Set(filtered.map(d => d.id))
    const count = {}
    sensors.filter(r => ids.has(r.device_id) && r.health !== 'REMOVED').forEach(r => { count[r.sensor_type_id] ||= { id: r.sensor_type_id, name: r.sensor_name, n: 0 }; count[r.sensor_type_id].n++ })
    return Object.values(count).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
  }, [filtered, sensors])
  async function applyDefaultsToShown() {
    if (!window.confirm(`Add each device's equipment-category default sensors to the ${filtered.length} device(s) shown? Sensors already mapped are left as they are.`)) return
    try { const n = await applyDefaultSensors(filtered.map(d => d.id)); await loadSensors(); alert(n ? `${n} sensor(s) added.` : 'Every device shown already has its default sensors.') }
    catch (e) { alert(isMissingSetup(e) ? 'Run sql/STEP243_device_sensors.sql in the Supabase SQL Editor first.' : e.message) }
  }
  const equipmentCategories = useMemo(() => [...new Set(devices.map(d => d.equipment_category).filter(Boolean))].sort(), [devices])

  // Same columns as the import template, so the file can be edited and
  // imported back (rows match existing devices by device_code / serial).
  async function exportDevices() {
    try {
      await ensureXLSX()
      const XLSX = window.XLSX
      const cols = TEMPLATES.devices.columns
      const value = (d, c) => c === 'customer_name' ? customerById[d.customer_id]?.name || ''
        : c === 'project_name' ? projectById[d.project_id]?.name || ''
        : c === 'sensors' ? [...new Set((sensorsOf[d.id] || []).filter(r => r.health !== 'REMOVED').map(r => r.sensor_name))].join('; ')
        : d[c] ?? ''
      const rows = filtered.map(d => cols.map(c => value(d, c)))
      const ws = XLSX.utils.aoa_to_sheet([cols, ...rows])
      ws['!cols'] = cols.map(c => ({ wch: c === 'notes' ? 40 : Math.max(14, c.length + 2) }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Devices')
      // reference sheets: the values the firmware_version and sensors columns accept
      const types = sensorTypes.length ? sensorTypes : []
      const sensorSheet = XLSX.utils.aoa_to_sheet([['Sensor (use this name)', 'Parameter', 'Unit', 'Active'],
        ...types.map(t => [t.name, t.parameter_key || '', t.unit || '', t.is_active ? 'Yes' : 'No'])])
      sensorSheet['!cols'] = [{ wch: 38 }, { wch: 28 }, { wch: 10 }, { wch: 8 }]
      XLSX.utils.book_append_sheet(wb, sensorSheet, 'Sensor list')
      const fwSheet = XLSX.utils.aoa_to_sheet([['Part number', 'Product', 'Firmware version', 'Status', 'Release date', 'Notes'],
        ...releases.map(r => [r.part_number, productByPart[r.part_number]?.name || '', r.version, r.status, r.release_date || '', r.release_notes || ''])])
      fwSheet['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 40 }]
      XLSX.utils.book_append_sheet(wb, fwSheet, 'Firmware list')
      XLSX.writeFile(wb, `device-instances-${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) { alert(e.message) }
  }

  const stats = useMemo(() => ({
    total: devices.length,
    deployed: devices.filter(d => d.status === 'deployed').length,
    inStorage: devices.filter(d => d.status === 'in_storage').length,
    attention: devices.filter(d => d.status === 'faulty' || d.status === 'replaced').length,
    decommissioned: devices.filter(d => d.status === 'decommissioned').length,
    warrantyDue: devices.filter(d => isWarrantyNear(d.warranty_end)).length,
  }), [devices])

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Device Instances</div>
          <div className="page-subtitle">Serialized device registry with deployment history and warranty tracking</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-outline" onClick={() => setFirmwareOpen(true)} title="Firmware release list per product"><Cpu size={15} /> Firmware releases</button>
          <button className="btn btn-outline" onClick={() => setCatalogOpen(true)} title="Sensor types and the default sensors per equipment category"><Radio size={15} /> Sensor catalog</button>
          <button className="btn btn-outline" onClick={exportDevices} disabled={!filtered.length} title="Download the devices shown (current search / filter) — edit and import back to update them"><Download size={15} /> Export to Excel</button>
          {canEdit && <button className="btn btn-outline" onClick={() => setShowImport(true)}><Upload size={15} /> Import from Excel</button>}
          {canEdit && <button className="btn btn-primary" onClick={openCreate}><Plus size={15} /> Register Device</button>}
        </div>
      </div>

      {canEdit && (
        <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Device Instances" size="xl">
          <ExcelImport type="devices" lookups={{ products, customers, projects, devices, releases, sensorTypes }}
            onSuccess={() => { setShowImport(false); load() }} onClose={() => setShowImport(false)} />
        </Modal>
      )}

      {(() => {
        // counts follow the project / site / status / search filters (not the KPI filter itself)
        const base = devices.filter(d => (!projectFilter || (projectFilter === '__none' ? !d.project_id : d.project_id === projectFilter)) && (!siteFilter || (d.current_location || '') === siteFilter) && (!statusFilter || d.status === statusFilter))
        const ids = new Set(base.map(d => d.id))
        const mapped = sensors.filter(r => ids.has(r.device_id) && r.health !== 'REMOVED')
        const down = mapped.filter(r => r.health === 'NOT_WORKING' || r.health === 'FAULTY')
        const units = base.reduce((n, d) => n + componentUnits(d.part_number), 0)
        const kinds = new Set(base.flatMap(d => (bomOf[d.part_number] || []).map(e => e.component_part_number))).size
        const pick = k => setKpi(v => (v === k ? '' : k))
        return (
          <div className="gl-kpis">
            <Kpi label="Devices" value={base.length} sub={`${base.filter(d => d.status === 'deployed').length} deployed · ${base.filter(d => d.status === 'in_storage').length} in storage`} accent="#6366f1" active={!kpi} onClick={() => setKpi('')} />
            <Kpi label="Sensors mapped" value={mapped.length} sub={`${mapped.filter(r => r.health === 'WORKING').length} working · ${mapped.filter(r => r.health === 'NOT_REVIEWED').length} not reviewed`} accent="#0ea5e9" active={kpi === 'SENSORS'} onClick={() => pick('SENSORS')} />
            <Kpi label="Sensors down" value={down.length} sub={`${new Set(down.map(r => r.device_id)).size} device(s) affected`} accent="#ef4444" active={kpi === 'DOWN'} onClick={() => pick('DOWN')} />
            <Kpi label="Other components" value={units} sub={kinds ? `${kinds} part type${kinds === 1 ? '' : 's'} from product BOMs` : 'No BOM on these products'} accent="#8b5cf6" />
            <Kpi label="Firmware update due" value={base.filter(fwDue).length} sub="Outdated, deprecated or unlisted" accent="#f59e0b" active={kpi === 'FIRMWARE'} onClick={() => pick('FIRMWARE')} />
            <Kpi label="Warranty ≤30 days" value={base.filter(d => isWarrantyNear(d.warranty_end)).length} sub={`${base.filter(d => d.status === 'faulty' || d.status === 'replaced').length} faulty / replaced`} accent="#f97316" active={kpi === 'WARRANTY'} onClick={() => pick('WARRANTY')} />
          </div>
        )
      })()}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <div style={{ flex: '1 1 220px', minWidth: 200 }}><SearchBox value={search} onChange={setSearch} placeholder="Search serial, device code, equipment, site, firmware..." /></div>
        <select className="form-select" style={{ width: 'auto', minWidth: 170, flex: '1 1 170px', maxWidth: 260 }} value={projectFilter} onChange={e => { setProjectFilter(e.target.value); setSiteFilter('') }}>
          <option value="">All projects</option>
          {projectsInUse.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="__none">No project</option>
        </select>
        <select className="form-select" style={{ width: 'auto', minWidth: 150, flex: '1 1 150px', maxWidth: 240 }} value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
          <option value="">All sites</option>
          {sites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="form-select" style={{ width: 'auto', flex: '1 1 140px', maxWidth: 200 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{SL[s]}</option>)}
        </select>
        <select className="form-select" style={{ width: 'auto', flex: '1 1 190px', maxWidth: 280 }} value={sensorFilter} onChange={e => setSensorFilter(e.target.value)} title="Filter by sensor">
          <option value="">All sensors</option>
          <optgroup label="Sensor status">
            <option value="down">Any sensor down</option>
            <option value="unreviewed">Sensor not reviewed</option>
            <option value="none">No sensors mapped</option>
          </optgroup>
          {sensorTypes.length > 0 && <optgroup label="Sensor type">
            {SENSOR_KINDS.filter(k => sensorTypes.some(t => (t.sensor_kind || 'Other') === k)).map(k => <option key={`kind:${k}`} value={`kind:${k}`}>{k} sensors</option>)}
          </optgroup>}
          {sensorTypes.length > 0 && <optgroup label="Has sensor fitted">
            {sensorTypes.map(t => <option key={`has:${t.id}`} value={`has:${t.id}`}>With {t.name}</option>)}
          </optgroup>}
          {sensorTypes.length > 0 && <optgroup label="Missing sensor">
            {sensorTypes.map(t => <option key={`no:${t.id}`} value={`no:${t.id}`}>Without {t.name}</option>)}
          </optgroup>}
        </select>
        {canEdit && picked.size > 0 && <>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{picked.size} selected</span>
          <button className="btn btn-primary btn-sm" onClick={() => setBulkSensor('add')}><Plus size={13} /> Add sensor</button>
          <button className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }} onClick={() => setBulkSensor('remove')}><Trash2 size={13} /> Remove sensor</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>Clear</button>
        </>}
        <div className="gl-seg">
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><List size={13} /> Devices</button>
          <button className={view === 'sensors' ? 'on' : ''} onClick={() => setView('sensors')}><Grid3x3 size={13} /> Sensor map</button>
          <button className={view === 'summary' ? 'on' : ''} onClick={() => setView('summary')}><Radio size={13} /> Sensor summary</button>
        </div>
      </div>
      {sensorNote && <div className="alert alert-warning" style={{ marginBottom: 12, fontSize: 13 }}>{sensorNote}</div>}
      {(projectFilter || siteFilter || statusFilter || sensorFilter || search) && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{filtered.length} of {devices.length} devices{projectFilter && projectFilter !== '__none' ? ` · ${projectById[projectFilter]?.name}` : ''}{siteFilter ? ` · ${siteFilter}` : ''}{sensorFilter ? ` · ${sensorFilter === 'down' ? 'any sensor down' : sensorFilter === 'unreviewed' ? 'sensor not reviewed' : sensorFilter === 'none' ? 'no sensors mapped' : sensorFilter.startsWith('kind:') ? `${sensorFilter.slice(5)} sensors` : `${sensorFilter.startsWith('has:') ? 'with' : 'without'} ${sensorTypes.find(t => t.id === sensorFilter.slice(4))?.name || 'sensor'}`}` : ''}
        <button type="button" onClick={() => { setSearch(''); setProjectFilter(''); setSiteFilter(''); setStatusFilter(''); setSensorFilter('') }} style={{ marginLeft: 8, border: 'none', background: 'none', color: 'var(--c1)', cursor: 'pointer', font: 'inherit', padding: 0 }}>Clear filters</button></div>}

      {filtered.length === 0 ? <Empty icon="📡" title="No devices found" desc="Register a device instance to start tracking it" /> : view === 'summary' ? (() => {
        // one row per sensor type across the devices shown
        const ids = new Set(filtered.map(d => d.id))
        const lc = x => String(x || '').trim().toLowerCase()
        const rowsFor = sensors.filter(r => ids.has(r.device_id))
        const byType = {}
        const row = (id, name) => (byType[id] ||= { id, name, kind: kindOf({ sensor_type_id: id }, sensorTypes), devices: new Set(), fitted: 0, working: 0, down: 0, unreviewed: 0, na: 0, removed: 0, missing: 0 })
        for (const r of rowsFor) {
          const t = row(r.sensor_type_id, r.sensor_name)
          if (r.sensor_kind) t.kind = r.sensor_kind
          if (r.health === 'REMOVED') { t.removed++; continue }
          t.fitted++; t.devices.add(r.device_id)
          if (r.health === 'WORKING') t.working++
          else if (r.health === 'NOT_WORKING' || r.health === 'FAULTY') t.down++
          else if (r.health === 'NA') t.na++
          else t.unreviewed++
        }
        // defaults for each device's equipment category that aren't fitted
        for (const d of filtered) {
          const fittedTypes = new Set(rowsFor.filter(r => r.device_id === d.id && r.health !== 'REMOVED').map(r => r.sensor_type_id))
          for (const df of sensorDefaults.filter(x => lc(x.equipment_category) === lc(d.equipment_category))) {
            if (!fittedTypes.has(df.sensor_type_id)) row(df.sensor_type_id, sensorTypes.find(t => t.id === df.sensor_type_id)?.name || 'Sensor').missing++
          }
        }
        const kindRank = k => { const i = SENSOR_KINDS.indexOf(k); return i < 0 ? 99 : i }
        const list = Object.values(byType).sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || b.fitted - a.fitted || a.name.localeCompare(b.name))
        const groups = [...new Set(list.map(t => t.kind))].map(kind => ({ kind, items: list.filter(t => t.kind === kind) }))
        const COLS = ['devices', 'fitted', 'working', 'down', 'unreviewed', 'na', 'missing', 'removed']
        const sumOf = (items, k) => items.reduce((n, t) => n + (k === 'devices' ? t.devices.size : t[k]), 0)
        const sum = k => list.reduce((n, t) => n + (k === 'devices' ? t.devices.size : t[k]), 0)
        const openType = t => { setSensorFilter(`has:${t.id}`); setView('list') }
        return (
          <div className="table-wrap">
            <div className="gl-bar">
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{list.length} sensor{list.length === 1 ? '' : 's'} in {groups.length} type{groups.length === 1 ? '' : 's'} across {filtered.length} device{filtered.length === 1 ? '' : 's'} · click a sensor to list its devices</span>
            </div>
            {!list.length ? <Empty icon={<Radio size={26} />} title="No sensors mapped" desc="Set default sensors per equipment category in the Sensor catalog, or add sensors per device." /> : (
              <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
                <table className="gl-table">
                  <thead><tr>
                    <th className="gl-sticky">Sensor</th><th>Type</th><th className="num">Devices fitted</th><th className="num">Total fitted</th><th className="num">Working</th><th className="num">Not working / faulty</th>
                    <th className="num">Not reviewed</th><th className="num">N/A</th><th className="num">Not installed</th><th className="num">Removed</th>
                  </tr></thead>
                  <tbody>
                    {groups.map(g => [
                      <tr key={`h-${g.kind}`}>
                        <td className="gl-sticky" style={{ background: '#f1f5f9', fontWeight: 800, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.04em', cursor: 'pointer' }} title={`List devices with ${g.kind} sensors`} onClick={() => { setSensorFilter(`kind:${g.kind}`); setView('list') }}>{g.kind}</td>
                        <td style={{ background: '#f1f5f9' }} className="muted">{g.items.length} sensor{g.items.length === 1 ? '' : 's'}</td>
                        {COLS.map(k => <td key={k} className="num" style={{ background: '#f1f5f9', fontWeight: 700 }}>{sumOf(g.items, k)}</td>)}
                      </tr>,
                      ...g.items.map(t => (
                      <tr key={t.id} onClick={() => openType(t)} style={{ cursor: 'pointer' }} title={`List the devices with ${t.name}`}>
                        <td className="gl-sticky" style={{ fontWeight: 600, paddingLeft: 22 }}>{t.name}</td>
                        <td><span className="gl-tag">{t.kind}</span></td>
                        <td className="num">{t.devices.size}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{t.fitted}</td>
                        <td className="num" style={{ color: t.working ? '#047857' : undefined }}>{t.working}</td>
                        <td className="num" style={{ color: t.down ? '#b91c1c' : undefined, fontWeight: t.down ? 700 : 400 }}>{t.down}</td>
                        <td className="num" style={{ color: t.unreviewed ? '#b45309' : undefined }}>{t.unreviewed}</td>
                        <td className="num muted">{t.na}</td>
                        <td className="num" style={{ color: t.missing ? '#b45309' : undefined }}>{t.missing}</td>
                        <td className="num muted">{t.removed}</td>
                      </tr>
                    ))])}
                    <tr style={{ fontWeight: 800 }}>
                      <td className="gl-sticky" style={{ background: '#e2e8f0' }}>Total</td><td style={{ background: '#e2e8f0' }} />
                      {COLS.map(k => <td key={k} className="num" style={{ background: '#e2e8f0' }}>{sum(k)}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })() : view === 'sensors' ? (
        <div className="table-wrap">
          <div className="gl-bar">
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Sensor health for {filtered.length} device{filtered.length === 1 ? '' : 's'} — from each sensor's own status and the latest daily application review.</span>
            <div className="gl-grow" />
            {canEdit && <button className="btn btn-ghost btn-sm" onClick={applyDefaultsToShown}>Apply default sensors to these devices</button>}
          </div>
          {!mapColumns.length ? <Empty icon={<Radio size={26} />} title="No sensors mapped" desc="Set up default sensors per equipment category in the Sensor catalog, or add sensors per device." /> : (
            <div className="gl-tscroll">
              <table className="gl-table">
                <thead><tr>
                  <th className="gl-sticky">Device</th><th>Equipment</th><th>Summary</th>
                  {mapColumns.map(c => <th key={c.id} style={{ whiteSpace: 'normal', minWidth: 96, maxWidth: 130, lineHeight: 1.25 }}>{c.name}<div style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0, color: 'var(--c1)', marginTop: 2 }}>{kindOf({ sensor_type_id: c.id }, sensorTypes)}</div></th>)}
                </tr></thead>
                <tbody>{filtered.map(d => {
                  const mine = (sensorsOf[d.id] || []).filter(r => r.health !== 'REMOVED')
                  return (
                    <tr key={d.id}>
                      <td className="gl-sticky"><button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={() => setSensorsFor(d)}><span className="gl-code" style={{ color: 'var(--c1)' }}>{d.serial_number || d.device_code}</span></button><div className="gl-meta">{d.current_location || '—'}</div></td>
                      <td className="nowrap" style={{ fontSize: 12 }}>{[d.equipment_id, d.equipment_name].filter(Boolean).join(' · ') || '—'}{d.equipment_category && <div className="gl-meta">{d.equipment_category}</div>}</td>
                      <td><SensorSummary rows={mine} /></td>
                      {mapColumns.map(c => {
                        const hit = mine.filter(r => r.sensor_type_id === c.id)
                        if (!hit.length) return <td key={c.id} className="muted" style={{ textAlign: 'center' }}>·</td>
                        const worst = ['FAULTY', 'NOT_WORKING', 'NOT_REVIEWED', 'NA', 'WORKING'].find(h => hit.some(r => r.health === h)) || hit[0].health
                        const h = SENSOR_HEALTH[worst] || { label: worst, tone: 'gray' }
                        return <td key={c.id} title={hit.map(r => `${r.sensor_name}${r.position ? ` (${r.position})` : ''}: ${SENSOR_HEALTH[r.health]?.label || r.health}${r.last_check_date ? ` · ${dateFmt(r.last_check_date)}` : ''}`).join('\n')}><span className={`gl-pill ${h.tone}`}>{h.label}{hit.length > 1 ? ` ×${hit.length}` : ''}</span></td>
                      })}
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr>{canEdit && <th style={{ width: 32 }}><input type="checkbox" aria-label="Select all shown" checked={filtered.length > 0 && filtered.every(d => picked.has(d.id))} onChange={e => setPicked(e.target.checked ? new Set(filtered.map(d => d.id)) : new Set())} /></th>}<th>View</th><th>Serial No.</th><th>Product</th><th>Customer</th><th>Project</th><th>Location</th><th>Equipment</th><th>Firmware</th><th>Sensors</th><th>Status</th><th>Warranty Ends</th><th>Age</th><th>Claim Value</th>{canEdit && <th>Actions</th>}</tr></thead>
            <tbody>
              {filtered.map(d => {
                const near = isWarrantyNear(d.warranty_end)
                const { ageMonths, claimPct, claimValue } = ageAndClaimFor(d)
                return (
                  <tr key={d.id} onClick={() => openHistory(d)} style={{ cursor: 'pointer', background: picked.has(d.id) ? '#f5f7ff' : undefined }} title="Open device">
                    {canEdit && <td onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${d.serial_number || d.device_code}`} checked={picked.has(d.id)} onChange={() => togglePick(d.id)} /></td>}
                    <td onClick={e => e.stopPropagation()}><button className="btn btn-outline btn-sm" style={{ padding: '3px 10px', fontWeight: 700, whiteSpace: 'nowrap' }} title="Open device" onClick={() => openHistory(d)}><Eye size={12} /> View</button></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--c1)' }}>{d.serial_number || '—'}</td>
                    <td>{productByPart[d.part_number]?.name || d.part_number || '—'}</td>
                    <td>{customerById[d.customer_id]?.name || '—'}</td>
                    <td>{projectById[d.project_id]?.name || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.current_location || '—'}</td>
                    <td style={{ fontSize: 12 }}>{[d.equipment_id, d.equipment_name].filter(Boolean).join(' · ') || '—'}{d.equipment_category && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.equipment_category}</div>}</td>
                    <td style={{ fontSize: 12 }}><FirmwareBadge releases={releases} partNumber={d.part_number} version={d.firmware_version} /></td>
                    <td onClick={e => e.stopPropagation()}><SensorSummary rows={sensorsOf[d.id] || []} onClick={() => { setDetailTab('sensors'); openHistory(d) }} /></td>
                    <td><Pill status={d.status} /></td>
                    <td style={{ fontSize: 12, color: near ? 'var(--rose)' : 'var(--text-muted)', fontWeight: near ? 700 : 400 }}>
                      {d.warranty_end ? dateFmt(d.warranty_end) : '—'}{near && <span style={{ marginLeft: 4 }}>⚠</span>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{ageMonths != null ? `${ageMonths}mo` : '—'}</td>
                    <td style={{ fontSize: 12 }} title={claimPct != null ? `${claimPct}% of standard cost, based on the applied warranty policy's depreciation schedule` : ''}>
                      {claimValue != null ? <><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#e11d48' }}>{rupee(claimValue)}</span> <span style={{ color: 'var(--text-muted)' }}>({claimPct}%)</span></> : '—'}
                    </td>
                    {canEdit && <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-ghost btn-sm btn-icon" title="Move / Redeploy" onClick={() => openMove(d)}><ArrowRightLeft size={12} /></button>
                        <button className="btn btn-ghost btn-sm btn-icon" title="History & linked tasks" onClick={() => openHistory(d)}><History size={12} /></button>
                        <button className="btn btn-ghost btn-sm btn-icon" title="Sensors" onClick={() => { setDetailTab('sensors'); openHistory(d) }}><Radio size={12} /></button>
                        <button className="btn btn-ghost btn-sm btn-icon" title="View Warranty" onClick={() => navigate(`/warranty?tab=claims&device=${d.id}`)}><ShieldCheck size={12} /></button>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(d)}><Edit2 size={12} /></button>
                        <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(d.id)}><Trash2 size={12} /></button>
                      </div>
                    </td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Device' : 'Register Device'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : editing ? 'Update Device' : 'Register Device'}</button>
        </>}
      >
        <form onSubmit={handleSubmit}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Product</label>
              <select className="form-select" value={form.part_number} onChange={e => setForm(f => applyPartNumber(f, e.target.value))}>
                <option value="">Select…</option>{products.map(p => <option key={p.part_number} value={p.part_number}>{p.name} ({p.part_number})</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Serial Number *</label><input className="form-input" value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} required /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Warranty Policy</label>
              <select className="form-select" value={form.warranty_policy_id} onChange={e => setForm(f => applyPolicy(f, e.target.value))}>
                <option value="">No policy — default {productByPart[form.part_number]?.warranty_months || 12}mo warranty</option>
                {policies.map(p => <option key={p.id} value={p.id}>{p.policy_name} ({p.part_number || 'generic'}) — {p.warranty_duration_months}mo</option>)}
              </select>
              {form.warranty_policy_id && (() => {
                const policy = policyById[form.warranty_policy_id]
                const tiers = policy ? tiersByPolicy[policy.id] : null
                return policy ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {policy.coverage_type} coverage{tiers?.length ? `, ${tiers.length} age-based depreciation tier(s)` : ', flat 100% claim value at any age'}
                  </div>
                ) : null
              })()}
            </div>
            <div className="form-group"><label className="form-label">Installed Date</label>
              <input className="form-input" type="date" value={form.installed_date} onChange={e => setForm(f => applyInstallDate(f, e.target.value))} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Setting this auto-fits the warranty window below ({durationForPolicy(form.warranty_policy_id, form.part_number)}mo) and, for a new device, activates its warranty clock on save.</div>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Customer</label>
              <select className="form-select" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
                <option value="">None</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Project</label>
              <select className="form-select" value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
                <option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Status</label>
              <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUSES.map(s => <option key={s} value={s}>{SL[s]}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Current Location</label><input className="form-input" value={form.current_location} onChange={e => setForm(f => ({ ...f, current_location: e.target.value }))} placeholder="Site / warehouse" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Equipment ID</label><input className="form-input" value={form.equipment_id || ''} onChange={e => setForm(f => ({ ...f, equipment_id: e.target.value }))} placeholder="Client's asset code, e.g. DT-12" /></div>
            <div />
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Equipment Name</label><input className="form-input" value={form.equipment_name || ''} onChange={e => setForm(f => ({ ...f, equipment_name: e.target.value }))} placeholder="Machine it's fitted to, e.g. Dumper Truck #12" /></div>
            <div className="form-group"><label className="form-label">Equipment Category</label>
              <input className="form-input" list="device-equipment-categories" value={form.equipment_category || ''} onChange={e => setForm(f => ({ ...f, equipment_category: e.target.value }))} placeholder="Compressor, Pump, Dumper…" />
              <datalist id="device-equipment-categories">{equipmentCategories.map(c => <option key={c} value={c} />)}</datalist>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Copied to Go-Live when the device is enrolled; groups hours and tolerance there.</div>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Firmware Version</label>
              <FirmwareSelect releases={releases} partNumber={form.part_number} value={form.firmware_version} onChange={v => setForm(f => ({ ...f, firmware_version: v }))} />
            </div>
            <div className="form-group"><label className="form-label">Assigned To</label>
              <select className="form-select" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
                <option value="">Unassigned</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select></div>
            <div />
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Warranty Start</label><input className="form-input" type="date" value={form.warranty_start} onChange={e => setForm(f => ({ ...f, warranty_start: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Warranty End</label><input className="form-input" type="date" value={form.warranty_end} onChange={e => setForm(f => ({ ...f, warranty_end: e.target.value }))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" style={{ minHeight: 60 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
        </form>
      </Modal>

      {/* Move / Redeploy Modal */}
      <Modal open={!!showMove} onClose={() => setShowMove(null)} title={`Move / Redeploy — ${showMove?.serial_number || ''}`} size="md"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowMove(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleMoveSubmit} disabled={submitting}>{submitting ? 'Moving...' : 'Confirm Move'}</button>
        </>}
      >
        {showMove && <form onSubmit={handleMoveSubmit}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            Currently: <strong>{projectById[showMove.project_id]?.name || 'No project'}</strong> · <strong>{customerById[showMove.customer_id]?.name || 'No customer'}</strong> · <Pill status={showMove.status} />
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">To Project</label>
              <select className="form-select" value={moveForm.to_project_id} onChange={e => setMoveForm(f => ({ ...f, to_project_id: e.target.value }))}>
                <option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">To Customer</label>
              <select className="form-select" value={moveForm.to_customer_id} onChange={e => setMoveForm(f => ({ ...f, to_customer_id: e.target.value }))}>
                <option value="">None</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
          </div>
          <div className="form-group"><label className="form-label">New Status</label>
            <select className="form-select" value={moveForm.to_status} onChange={e => setMoveForm(f => ({ ...f, to_status: e.target.value }))}>
              {STATUSES.map(s => <option key={s} value={s}>{SL[s]}</option>)}
            </select></div>
          {moveForm.to_status === 'deployed' && (
            <div className="form-group">
              <label className="form-label">Warranty Policy</label>
              <select className="form-select" value={moveForm.warranty_policy_id} onChange={e => setMoveForm(f => ({ ...f, warranty_policy_id: e.target.value }))}>
                <option value="">No policy — default {productByPart[showMove.part_number]?.warranty_months || 12}mo warranty</option>
                {policies.map(p => <option key={p.id} value={p.id}>{p.policy_name} ({p.part_number || 'generic'}) — {p.warranty_duration_months}mo</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {(() => { const w = computeWarrantyWindow(new Date().toISOString().slice(0, 10), durationForPolicy(moveForm.warranty_policy_id, showMove.part_number)); return <>Deploying today activates a warranty window through <strong>{dateFmt(w.warrantyEnd)}</strong>.</> })()}
              </div>
            </div>
          )}
          <div className="form-group"><label className="form-label">Reason *</label><textarea className="form-textarea" value={moveForm.reason} onChange={e => setMoveForm(f => ({ ...f, reason: e.target.value }))} placeholder="Why is this device moving?" required /></div>
        </form>}
      </Modal>

      {/* Device view (row click): sensors, components, tasks & history, details */}
      {showHistory && (() => {
        const d = devices.find(x => x.id === showHistory.id) || showHistory
        const comps = bomOf[d.part_number] || []
        const Field2 = ({ k, v }) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}><span style={{ color: 'var(--text-muted)' }}>{k}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{v || '—'}</span></div>
        return (
          <Modal open onClose={() => setShowHistory(null)} title={`${d.serial_number || d.device_code} · ${productByPart[d.part_number]?.name || d.part_number || 'Device'}`} size="lg"
            footer={<>
              <CheckInHereButton device={d} profile={profile} projectId={d.project_id} site={d.current_location} />
              {canEdit && <button className="btn btn-ghost" onClick={() => { setShowHistory(null); openEdit(d) }}><Edit2 size={13} /> Edit</button>}
              {canEdit && <button className="btn btn-ghost" onClick={() => { setShowHistory(null); openMove(d) }}><ArrowRightLeft size={13} /> Move / redeploy</button>}
              <button className="btn btn-ghost" onClick={() => navigate(`/warranty?tab=claims&device=${d.id}`)}><ShieldCheck size={13} /> Warranty</button>
              <button className="btn btn-primary" onClick={() => setShowHistory(null)}>Close</button>
            </>}>
            <div className="gl-summary">
              <div><span>Equipment</span><span title={[d.equipment_id, d.equipment_name].filter(Boolean).join(' · ')}>{[d.equipment_id, d.equipment_name].filter(Boolean).join(' · ') || '—'}</span></div>
              <div><span>Category</span><span>{d.equipment_category || '—'}</span></div>
              <div><span>Project / site</span><span title={[projectById[d.project_id]?.name, d.current_location].filter(Boolean).join(' · ')}>{[projectById[d.project_id]?.name, d.current_location].filter(Boolean).join(' · ') || '—'}</span></div>
              <div><span>Status</span><span><Pill status={d.status} /></span></div>
              <div><span>Firmware</span><span><FirmwareBadge releases={releases} partNumber={d.part_number} version={d.firmware_version} compact /></span></div>
              <div><span>Serial</span><span className="gl-code">{d.serial_number}</span></div>
              <div><span>Sensors</span><span><SensorSummary rows={sensorsOf[d.id] || []} /></span></div>
              <div><span>Warranty end</span><span>{d.warranty_end ? dateFmt(d.warranty_end) : '—'}</span></div>
            </div>
            <div className="gl-seg" style={{ marginBottom: 14 }}>
              {[['sensors', `Sensors (${deviceSensors(d.id).length})`], ['components', `Components (${comps.length})`], ['visits', 'Visits'], ['history', 'Tasks & history'], ['details', 'Details']].map(([k, l]) => (
                <button key={k} className={detailTab === k ? 'on' : ''} onClick={() => setDetailTab(k)}>{l}</button>
              ))}
            </div>
            {detailTab === 'sensors' && <DeviceSensorSlots device={d} canEdit={canEdit} onChanged={loadSensors} />}
            {detailTab === 'components' && (!comps.length
              ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{d.part_number ? `No active bill of materials for ${d.part_number}. Add one in BOM Management.` : 'Pick a product for this device to see its components.'}</div>
              : <div className="table-wrap" style={{ marginBottom: 0 }}>
                  <table className="gl-table">
                    <thead><tr><th>Component</th><th>Part number</th><th className="num">Qty per device</th><th>Notes</th></tr></thead>
                    <tbody>{comps.map(c => (
                      <tr key={c.id}><td style={{ fontWeight: 600 }}>{partNames[c.component_part_number] || '—'}</td><td className="gl-code">{c.component_part_number}</td><td className="num">{Number(c.quantity)}</td><td className="muted" style={{ fontSize: 12 }}>{c.notes || '—'}</td></tr>
                    ))}</tbody>
                  </table>
                </div>)}
            {detailTab === 'visits' && <DeviceVisitsPanel deviceId={d.id} people={users} />}
            {detailTab === 'history' && <>
              <DeviceTasksPanel device={d} people={users} organizationId={profile?.organization_id} reloadKey={tasksKey} onUpgrade={canEdit ? () => setUpgradeFor(d) : null} />
              <div style={{ fontWeight: 700, fontSize: 13, margin: '18px 0 8px' }}>Deployment moves</div>
              {history.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>This device hasn't been moved or redeployed.</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {history.map(h => (
                    <div key={h.id} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 12, paddingBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}><Clock size={11} />{dateFmt(h.moved_date)} · {h.mover?.full_name || 'Unknown'}</div>
                      <div style={{ fontSize: 13, marginTop: 3 }}><Pill status={h.from_status} /> → <Pill status={h.to_status} /></div>
                      {h.reason && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{h.reason}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>}
            {detailTab === 'details' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 24px' }}>
                <div>
                  <Field2 k="Serial number" v={d.serial_number} /><Field2 k="Product" v={productByPart[d.part_number]?.name ? `${productByPart[d.part_number].name} (${d.part_number})` : d.part_number} />
                  <Field2 k="Customer" v={customerById[d.customer_id]?.name} /><Field2 k="Project" v={projectById[d.project_id]?.name} /><Field2 k="Current location" v={d.current_location} />
                </div>
                <div>
                  <Field2 k="Installed" v={d.installed_date && dateFmt(d.installed_date)} /><Field2 k="Warranty" v={d.warranty_start ? `${dateFmt(d.warranty_start)} – ${dateFmt(d.warranty_end)}` : null} />
                  <Field2 k="Assigned to" v={users.find(u => u.id === d.assigned_to)?.full_name} /><Field2 k="Equipment ID" v={d.equipment_id} /><Field2 k="Equipment name" v={d.equipment_name} /><Field2 k="Notes" v={d.notes} />
                </div>
              </div>
            )}
          </Modal>
        )
      })()}

      {bulkSensor && <BulkSensorModal mode={bulkSensor} deviceIds={[...picked]} onClose={() => setBulkSensor(null)}
        onDone={async msg => { setBulkSensor(null); await loadSensors(); alert(msg) }} />}
      {firmwareOpen && <FirmwareReleasesModal products={products} canEdit={canEdit} onClose={() => setFirmwareOpen(false)} onChanged={reloadReleases} />}
      {catalogOpen && <SensorCatalogModal categories={equipmentCategories} products={products} canEdit={canEdit} onClose={() => setCatalogOpen(false)} onChanged={loadSensors} />}
      {sensorsFor && <DeviceSensorsModal device={sensorsFor} canEdit={canEdit} onClose={() => setSensorsFor(null)} onChanged={loadSensors} />}
      {upgradeFor && <FirmwareUpgradeModal device={upgradeFor} releases={releases} people={users} organizationId={profile?.organization_id} profile={profile}
        onClose={() => setUpgradeFor(null)} onDone={() => { setUpgradeFor(null); setTasksKey(k => k + 1) }} />}

      <Confirm open={!!deleteConfirm} message="Delete this device instance? This cannot be undone." danger onConfirm={() => handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}
