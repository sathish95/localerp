import { supabase } from './supabase'

// Support visits (STEP248): a check-in (time_logs) marked visit_type
// 'SUPPORT', optionally tied to a go-live engagement / site, with the
// devices worked on (time_log_devices). Hours bill to the project's Support
// costs through sync_project_support_visits() in the database.

export const ACTIVITY_TYPES = [
  { key: 'INSPECTION', label: 'Inspection' },
  { key: 'INSTALLATION', label: 'Installation' },
  { key: 'FIRMWARE_UPGRADE', label: 'Firmware upgrade' },
  { key: 'SENSOR_FITTING', label: 'Sensor fitting' },
  { key: 'REPAIR', label: 'Repair' },
  { key: 'CALIBRATION', label: 'Calibration' },
  { key: 'REPLACEMENT', label: 'Replacement' },
  { key: 'OTHER', label: 'Other' },
]
export const activityLabel = k => ACTIVITY_TYPES.find(a => a.key === k)?.label || k

const SETUP = 'Support visits need sql/STEP248_support_visits.sql — run it in the Supabase SQL Editor, then reload.'
const friendly = e => (/does not exist|schema cache|visit_type|engagement_id|time_log_devices|device_visits/i.test(e?.message || '') ? new Error(SETUP) : e)

// Tells the Check-In widget (and anything else listening) to reload.
export const CHECKIN_EVENT = 'neox:checkin-changed'
export const announceCheckin = () => window.dispatchEvent(new Event(CHECKIN_EVENT))

// Browser location, best effort: resolves null if denied, unavailable or slow.
export function getGps(timeoutMs = 6000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    const t = setTimeout(() => resolve(null), timeoutMs)
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(t); resolve({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 }) },
      () => { clearTimeout(t); resolve(null) },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    )
  })
}
export const mapLink = (lat, lng) => (lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null)

export async function getActiveLog(employeeId) {
  const { data } = await supabase.from('time_logs').select('*,project:projects(id,name)')
    .eq('employee_id', employeeId).is('check_out', null).order('check_in', { ascending: false }).limit(1)
  return data?.[0] || null
}

// Starts a support visit check-in. Returns the new time_logs row.
export async function startVisit({ employeeId, projectId, engagementId, site, comment, gps }) {
  const { data, error } = await supabase.from('time_logs').insert({
    employee_id: employeeId, project_id: projectId || null, work_date: new Date().toISOString().slice(0, 10),
    check_in: new Date().toISOString(), comment: comment || null,
    visit_type: 'SUPPORT', engagement_id: engagementId || null, site: site || null,
    check_in_lat: gps?.lat ?? null, check_in_lng: gps?.lng ?? null,
  }).select('*,project:projects(id,name)').single()
  if (error) throw friendly(error)
  return data
}

export async function checkOutLog(log, gps) {
  const now = new Date()
  const hrs = Math.round((now - new Date(log.check_in)) / 3600000 * 100) / 100
  const patch = { check_out: now.toISOString(), hours_worked: hrs }
  if (gps && log.visit_type === 'SUPPORT') Object.assign(patch, { check_out_lat: gps.lat, check_out_lng: gps.lng })
  const { error } = await supabase.from('time_logs').update(patch).eq('id', log.id)
  if (error) throw friendly(error)
  return hrs
}

export async function listLogDevices(logId) {
  const { data, error } = await supabase.from('time_log_devices').select('*').eq('time_log_id', logId).order('created_at')
  if (error) throw friendly(error)
  return data || []
}
export async function addDeviceToLog(logId, { deviceId, activity, minutes, note }) {
  const { error } = await supabase.from('time_log_devices').insert({
    time_log_id: logId, device_id: deviceId, activity_type: activity || 'INSPECTION',
    minutes: minutes === '' || minutes == null ? null : Math.max(0, Math.round(Number(minutes))), note: note?.trim() || null,
  })
  if (error) throw friendly(error)
}
export async function removeLogDevice(id) {
  const { error } = await supabase.from('time_log_devices').delete().eq('id', id)
  if (error) throw friendly(error)
}

// Visits to one device, newest first.
export async function listDeviceVisits(deviceId) {
  const { data, error } = await supabase.from('device_visits').select('*').eq('device_id', deviceId).order('check_in', { ascending: false }).limit(200)
  if (error) throw friendly(error)
  return data || []
}

// Support visits for an engagement (or a project) in a date range, with their devices.
export async function listVisits({ engagementId, projectId, from, to }) {
  let q = supabase.from('time_logs').select('*').eq('visit_type', 'SUPPORT').gte('work_date', from).lte('work_date', to).order('check_in', { ascending: false })
  q = engagementId ? q.eq('engagement_id', engagementId) : q.eq('project_id', projectId)
  const { data: logs, error } = await q
  if (error) throw friendly(error)
  const ids = (logs || []).map(l => l.id)
  const { data: devs, error: e2 } = ids.length ? await supabase.from('device_visits').select('*').in('time_log_id', ids) : { data: [] }
  if (e2) throw friendly(e2)
  return (logs || []).map(l => ({ ...l, devices: (devs || []).filter(d => d.time_log_id === l.id) }))
}

// "Check in here" from a device: adds the device to the running visit, or
// starts a support visit for it (project / engagement from the device).
export async function checkInOnDevice({ employeeId, device, projectId, engagementId, site, activity, minutes, note }) {
  let log = await getActiveLog(employeeId)
  let started = false
  if (!log) {
    const gps = await getGps()
    log = await startVisit({ employeeId, projectId: projectId || device.project_id, engagementId, site: site || device.current_location || device.site, gps })
    started = true
  }
  await addDeviceToLog(log.id, { deviceId: device.id, activity, minutes, note })
  announceCheckin()
  return { log, started }
}
