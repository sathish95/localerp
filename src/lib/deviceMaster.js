import { supabase } from './supabase'

// Device master extras: firmware releases per product (STEP242), sensor
// mapping (STEP243) and tasks linked to a device (STEP244). Shared by
// Device Instances, Go-Live and Task Management.

const MISSING = /schema cache|does not exist|PGRST20[25]/i
export const setupMessage = step => `Run sql/${step} in the Supabase SQL Editor, then reload.`
export const isMissingSetup = e => MISSING.test(e?.message || '') || ['PGRST202', 'PGRST205', '42P01', '42703'].includes(e?.code)

/* ═══ Firmware releases ═══ */

export const FIRMWARE_STATUSES = [
  { key: 'CURRENT', label: 'Current', tone: 'green' },
  { key: 'SUPPORTED', label: 'Supported', tone: 'gray' },
  { key: 'DEPRECATED', label: 'Deprecated', tone: 'red' },
]

export async function listFirmware() {
  const { data, error } = await supabase.from('product_firmware_versions').select('*')
    .order('part_number').order('release_date', { ascending: false, nullsFirst: false }).order('version', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveFirmware(row) {
  const payload = {
    part_number: row.part_number, version: String(row.version || '').trim(), release_date: row.release_date || null,
    status: row.status || 'SUPPORTED', release_notes: row.release_notes?.trim() || null,
  }
  const q = row.id ? supabase.from('product_firmware_versions').update(payload).eq('id', row.id) : supabase.from('product_firmware_versions').insert(payload)
  const { error } = await q
  if (error) throw error.code === '23505' ? new Error(`Version ${payload.version} already exists for this product`) : error
}

export async function deleteFirmware(id) {
  const { error } = await supabase.from('product_firmware_versions').delete().eq('id', id)
  if (error) throw error
}

// Releases of one product, current first, then newest.
export const releasesFor = (releases, partNumber) => {
  const order = { CURRENT: 0, SUPPORTED: 1, DEPRECATED: 2 }
  return releases.filter(r => r.part_number === partNumber).sort((a, b) => order[a.status] - order[b.status] || String(b.release_date || '').localeCompare(String(a.release_date || '')))
}

// Where a device's firmware stands against its product's release list.
//   CURRENT / SUPPORTED / DEPRECATED, OUTDATED (supported but not current),
//   UNLISTED (not in the list), NONE (no firmware recorded), NO_LIST
export function firmwareState(releases, partNumber, version) {
  const list = releasesFor(releases, partNumber)
  const v = String(version || '').trim()
  if (!v) return { state: 'NONE', current: list.find(r => r.status === 'CURRENT')?.version }
  if (!list.length) return { state: 'NO_LIST' }
  const current = list.find(r => r.status === 'CURRENT')?.version
  const hit = list.find(r => r.version === v)
  if (!hit) return { state: 'UNLISTED', current }
  if (hit.status === 'CURRENT') return { state: 'CURRENT', current }
  if (hit.status === 'DEPRECATED') return { state: 'DEPRECATED', current }
  return { state: current ? 'OUTDATED' : 'SUPPORTED', current }
}

/* ═══ Sensors ═══ */

// Sensor type / kind (STEP251), for grouping and filtering.
export const SENSOR_KINDS = ['Temperature', 'Pressure', 'Level', 'Position', 'Load', 'Status', 'Runtime', 'Speed', 'Voltage / Current', 'Location', 'Other']
export const kindOf = (row, types) => row?.sensor_kind || types?.find(t => t.id === row?.sensor_type_id)?.sensor_kind || 'Other'

export const SENSOR_STATUSES = [
  { key: 'ACTIVE', label: 'Active' },
  { key: 'FAULTY', label: 'Faulty' },
  { key: 'REMOVED', label: 'Removed' },
]
// health from device_sensor_status
export const SENSOR_HEALTH = {
  WORKING: { label: 'Working', tone: 'green' },
  NOT_WORKING: { label: 'Not working', tone: 'red' },
  FAULTY: { label: 'Faulty', tone: 'red' },
  NA: { label: 'N/A', tone: 'gray' },
  NOT_REVIEWED: { label: 'Not reviewed', tone: 'amber' },
  REMOVED: { label: 'Removed', tone: 'gray' },
}

export async function listSensorTypes() {
  const { data, error } = await supabase.from('sensor_types').select('*').order('name')
  if (error) throw error
  return data || []
}
export async function saveSensorType(row) {
  const payload = {
    name: row.name.trim(), parameter_key: row.parameter_key?.trim() || null, unit: row.unit?.trim() || null,
    part_number: row.part_number || null, description: row.description?.trim() || null, is_active: row.is_active !== false,
    // unit cost (STEP246) only when present, so saving works before that step is run
    ...(row.unit_cost !== undefined ? { unit_cost: row.unit_cost === '' || row.unit_cost == null ? null : Number(row.unit_cost) } : {}),
    ...(row.sensor_kind !== undefined ? { sensor_kind: row.sensor_kind || null } : {}),
  }
  const q = row.id ? supabase.from('sensor_types').update(payload).eq('id', row.id) : supabase.from('sensor_types').insert(payload)
  const { error } = await q
  if (error) throw error.code === '23505' ? new Error(`A sensor type called "${payload.name}" already exists`) : error
}

export async function listSensorDefaults() {
  const { data, error } = await supabase.from('equipment_sensor_defaults').select('*').order('equipment_category')
  if (error) throw error
  return data || []
}
export async function addSensorDefault(category, sensorTypeId) {
  const { error } = await supabase.from('equipment_sensor_defaults').insert({ equipment_category: category.trim(), sensor_type_id: sensorTypeId })
  if (error && error.code !== '23505') throw error
}
export async function removeSensorDefault(id) {
  const { error } = await supabase.from('equipment_sensor_defaults').delete().eq('id', id)
  if (error) throw error
}

// Live sensor rows (device_sensor_status view); pass device ids to narrow.
// Supabase returns at most 1000 rows per request, and long id lists overflow
// the URL — so read in pages, and in id batches, until everything is in.
export async function fetchAllRows(build, pageSize = 1000) {
  const out = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < pageSize) return out
  }
}

export async function listDeviceSensors(deviceIds) {
  if (!deviceIds) return fetchAllRows(() => supabase.from('device_sensor_status').select('*').order('id'))
  const ids = [...new Set(deviceIds.filter(Boolean))]
  if (!ids.length) return []
  const out = []
  for (let i = 0; i < ids.length; i += 150) {
    const batch = ids.slice(i, i + 150)
    out.push(...await fetchAllRows(() => supabase.from('device_sensor_status').select('*').in('device_id', batch).order('id')))
  }
  return out.sort((a, b) => String(a.sensor_name).localeCompare(String(b.sensor_name)))
}
export async function addDeviceSensor(deviceId, row) {
  const { error } = await supabase.from('device_sensors').insert({
    device_id: deviceId, sensor_type_id: row.sensor_type_id, serial_number: row.serial_number?.trim() || null,
    position: row.position?.trim() || null, installed_at: row.installed_at || null, notes: row.notes?.trim() || null, source: 'MANUAL',
  })
  if (error) throw error
}
export async function updateDeviceSensor(id, patch) {
  const { error } = await supabase.from('device_sensors').update(patch).eq('id', id)
  if (error) throw error
}
// Fits one sensor type on each device that doesn't have it (re-activating a
// removed one where it exists). Returns the number of devices changed.
export async function bulkAddSensor(deviceIds, sensorTypeId) {
  if (!deviceIds.length) return 0
  const { data: current, error } = await supabase.from('device_sensors').select('id,device_id,status').eq('sensor_type_id', sensorTypeId).in('device_id', deviceIds)
  if (error) throw error
  let n = 0
  const fresh = []
  for (const id of deviceIds) {
    const mine = (current || []).filter(x => x.device_id === id)
    if (mine.some(x => x.status !== 'REMOVED')) continue
    if (mine.length) {
      const { error: e } = await supabase.from('device_sensors').update({ status: 'ACTIVE' }).eq('id', mine[0].id)
      if (e) throw e
    } else fresh.push({ device_id: id, sensor_type_id: sensorTypeId, source: 'MANUAL' })
    n++
  }
  if (fresh.length) {
    const { error: e } = await supabase.from('device_sensors').insert(fresh)
    if (e) throw e
  }
  return n
}
// Removes (marks REMOVED) one sensor type from each device. Returns the number of sensors removed.
export async function bulkRemoveSensor(deviceIds, sensorTypeId) {
  if (!deviceIds.length) return 0
  const { data, error } = await supabase.from('device_sensors').update({ status: 'REMOVED' })
    .eq('sensor_type_id', sensorTypeId).in('device_id', deviceIds).neq('status', 'REMOVED').select('id')
  if (error) throw error
  return (data || []).length
}

export async function applyDefaultSensors(deviceIds) {
  const { data, error } = await supabase.rpc('apply_default_sensors', { p_device_ids: deviceIds })
  if (error) throw error
  return data || 0
}

// { total, working, problem, notReviewed } over non-removed sensors
export function sensorSummary(rows) {
  const live = rows.filter(r => r.health !== 'REMOVED')
  return {
    total: live.length,
    working: live.filter(r => r.health === 'WORKING').length,
    problem: live.filter(r => r.health === 'NOT_WORKING' || r.health === 'FAULTY').length,
    notReviewed: live.filter(r => r.health === 'NOT_REVIEWED').length,
    na: live.filter(r => r.health === 'NA').length,
  }
}

/* ═══ Tasks linked to a device ═══ */

export async function listDeviceTasks(deviceId) {
  const { data, error } = await supabase.from('project_tasks')
    .select('id,task_id,task_name,status,department_id,assigned_to,planned_end_date,created_at,updated_at,device_task_kind,firmware_target_version,priority')
    .eq('device_id', deviceId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Firmware upgrade task: when it reaches a closed status the device's
// firmware becomes the target version (STEP244 trigger).
export async function createFirmwareUpgradeTask({ device, targetVersion, assignedTo, dueDate, projectId, note, organizationId }, profile) {
  let departmentId = null
  if (assignedTo) {
    const { data: p } = await supabase.from('profiles').select('department_id').eq('id', assignedTo).maybeSingle()
    departmentId = p?.department_id || null
  }
  const label = device.serial_number || device.device_code
  const equip = [device.equipment_id, device.equipment_name].filter(Boolean).join(' · ')
  const { data, error } = await supabase.from('project_tasks').insert({
    task_name: `Firmware upgrade ${device.firmware_version || '—'} → ${targetVersion} · ${label}${equip ? ` (${equip})` : ''}`,
    task_type: 'task',
    description: `Upgrade device ${label}${equip ? ` fitted to ${equip}` : ''} from firmware ${device.firmware_version || '(not recorded)'} to ${targetVersion}.${note ? `\n\n${note}` : ''}\n\nWhen this task is closed the device's firmware is updated to ${targetVersion} automatically.`,
    priority: 'medium', status: 'backlog', project_id: projectId || device.project_id || null, department_id: departmentId,
    assigned_to: assignedTo || null, planned_end_date: dueDate || null, organization_id: organizationId,
    device_id: device.id, device_task_kind: 'FIRMWARE_UPGRADE', firmware_target_version: targetVersion, created_by: profile.id,
  }).select('id,task_id').single()
  if (error) throw error
  return data
}

// Device picker search for Task Management.
export async function searchDevicesForLink(term) {
  const t = term.trim()
  if (!t) return []
  const like = `%${t.replace(/[%_,()]/g, ' ')}%`
  const { data, error } = await supabase.from('device_instances').select('*')
    .or(`device_code.ilike.${like},serial_number.ilike.${like},equipment_id.ilike.${like},equipment_name.ilike.${like}`).limit(12)
  if (error) throw error
  return data || []
}
export async function getDevice(id) {
  if (!id) return null
  const { data } = await supabase.from('device_instances').select('*').eq('id', id).maybeSingle()
  return data
}
