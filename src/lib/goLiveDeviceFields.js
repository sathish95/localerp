// Go-Live Support — per-device "Go-live" flag (STEP259) and the engagement's
// custom device fields. Pure helpers, no Supabase import; unit-tested in
// goLiveDeviceFields.test.mjs.
//
// Custom fields are defined per engagement in config.device_fields, edited in
// the engagement form as one line per field:
//   Zone | list | North, South, East
//   Contract ref | text
//   Critical asset | yesno
// Values live on golive_enrollments.custom_fields ({ key: value }). Every
// field can be set when adding / editing devices, round-trips through the
// Devices Excel sheet and is a filter on every Go-Live tab.

export const FIELD_TYPES = [
  { key: 'list', label: 'Dropdown list' },
  { key: 'text', label: 'Text' },
  { key: 'yesno', label: 'Yes / No' },
]

export const fieldKey = label => String(label ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)

// Names already used by built-in device columns — a custom field can't reuse them.
const RESERVED = new Set(['golive', 'go_live', 'go_live_yes_no', 'live_since', 'ref', 'device_id', 'device', 'serial_number', 'site', 'equipment_id', 'equipment_name',
  'equipment_category', 'category', 'firmware', 'firmware_version', 'sensors', 'status', 'support_status', 'status_reason', 'notes', 'part_number', 'warranty_end'])

const TYPE_ALIASES = { list: 'list', select: 'list', dropdown: 'list', options: 'list', text: 'text', yesno: 'yesno', 'yes/no': 'yesno', boolean: 'yesno', bool: 'yesno' }

export function parseFieldLines(text) {
  const out = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const [label = '', rawType = '', rawOpts = ''] = line.split('|').map(s => s.trim())
    const key = fieldKey(label)
    if (!key || RESERVED.has(key) || out.some(f => f.key === key)) continue
    const options = rawOpts.split(',').map(s => s.trim()).filter(Boolean)
    const type = TYPE_ALIASES[rawType.toLowerCase().replace(/\s+/g, '')] || (options.length ? 'list' : 'text')
    out.push({ key, label, type, ...(type === 'list' ? { options: [...new Set(options)] } : {}) })
  }
  return out
}

export const fieldLines = fields => fields.map(f => [f.label, f.type, f.type === 'list' ? (f.options || []).join(', ') : ''].filter(Boolean).join(' | ')).join('\n')

export const deviceFields = config => (Array.isArray(config?.device_fields) ? config.device_fields.filter(f => f?.key && f?.label) : [])

export const fieldValue = (e, f) => {
  const v = e?.custom_fields?.[f.key]
  return v == null || v === '' ? null : v
}

export const yesNo = v => (v === true ? 'Yes' : v === false ? 'No' : '')

// Reads "Yes" / "No" style input; undefined = not understood, null = blank.
export function parseYesNo(raw) {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return null
  if (['yes', 'y', 'true', '1', 'live', 'go-live', 'golive'].includes(s)) return true
  if (['no', 'n', 'false', '0', 'not live'].includes(s)) return false
  return undefined
}

export const fieldDisplay = (e, f) => {
  const v = fieldValue(e, f)
  return f.type === 'yesno' ? yesNo(v) : v == null ? '' : String(v)
}

// Filter choices for a field: its list options plus any value actually used.
export function filterChoices(f, enrollments) {
  if (f.type === 'yesno') return ['Yes', 'No']
  const used = enrollments.map(e => fieldValue(e, f)).filter(v => v != null).map(String)
  return [...new Set([...(f.options || []), ...used])].sort((a, b) => a.localeCompare(b))
}

// Device filter shared by every tab: { golive: '' | 'YES' | 'NO', fields: { key: value | '__blank' } }
export const EMPTY_DEVICE_FILTER = { golive: '', fields: {} }

export const deviceFilterActive = df => !!(df?.golive || Object.values(df?.fields || {}).some(Boolean))

export function matchDevice(e, df, fields = []) {
  if (!df) return true
  if (df.golive === 'YES' && !e?.is_golive) return false
  if (df.golive === 'NO' && e?.is_golive) return false
  for (const f of fields) {
    const want = df.fields?.[f.key]
    if (!want) continue
    const have = fieldDisplay(e, f)
    if (want === '__blank' ? have !== '' : have !== want) return false
  }
  return true
}

// Go-live KPI numbers over live (not unenrolled) enrollments.
export function goLiveCounts(enrollments) {
  const live = enrollments.filter(e => !e.deleted_at && !e.unenrolled_at)
  const yes = live.filter(e => e.is_golive)
  return { total: live.length, live: yes.length, notLive: live.length - yes.length, pct: live.length ? Math.round((yes.length / live.length) * 100) : 0 }
}

// Normalises a value typed into a form / sheet for a field; { error } when it doesn't fit.
export function coerceFieldValue(f, raw) {
  if (f.type === 'yesno') {
    if (typeof raw === 'boolean') return { value: raw }
    const b = parseYesNo(raw)
    return b === undefined ? { error: `${f.label}: “${raw}” is not Yes / No` } : { value: b }
  }
  const s = String(raw ?? '').trim()
  if (!s) return { value: null }
  if (f.type === 'list' && f.options?.length) {
    const hit = f.options.find(o => o.toLowerCase() === s.toLowerCase())
    return hit ? { value: hit } : { error: `${f.label}: “${s}” is not one of ${f.options.join(', ')}` }
  }
  return { value: s }
}
