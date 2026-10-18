import { Search as SearchIcon } from 'lucide-react'
import { Badge } from '../ui'
import { DAILY_RESULTS, FOLLOW_UP_FLAGS, ENGAGEMENT_STATUSES, PRIORITIES, labelOf } from '../../lib/goLiveRules'
import { filterChoices, deviceFilterActive, EMPTY_DEVICE_FILTER } from '../../lib/goLiveDeviceFields'

// Shared bits for the Go-Live Support screens. Colour is never the only
// signal — every badge carries its label.

export const MANAGER_ROLES = ['admin', 'ceo', 'manager', 'department_head', 'cto', 'project_manager']

export function ResultBadge({ result }) {
  if (!result) return <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>—</span>
  const r = DAILY_RESULTS[result]
  return <Badge type={r?.badge || 'gray'}>{r?.label || result}</Badge>
}

export function FlagBadge({ flag }) {
  if (!flag) return null
  const f = FOLLOW_UP_FLAGS[flag]
  return <Badge type={f?.badge || 'gray'}>{f?.label || flag}</Badge>
}

export function EngagementStatusBadge({ status }) {
  const s = ENGAGEMENT_STATUSES.find(x => x.key === status)
  return <Badge type={s?.badge || 'gray'}>{s?.label || status}</Badge>
}

export function PriorityBadge({ priority }) {
  if (!priority) return <span style={{ color: 'var(--ink-muted)' }}>—</span>
  const type = { P1_CRITICAL: 'danger', P2_HIGH: 'warning', P3_NORMAL: 'info', P4_REQUEST: 'gray' }[priority]
  return <Badge type={type}>{PRIORITIES.find(p => p.key === priority)?.short || priority} · {labelOf(PRIORITIES, priority).split(' - ')[1]}</Badge>
}

export const personName = (people, id, legacy) => people.find(p => p.id === id)?.full_name || (legacy ? `${legacy} (legacy)` : '')

// Person picker — every person field stores a user id (§6.2). `prefer`
// floats the ids holding the relevant roster role to the top; `warn` shows
// a soft warning when the chosen user doesn't hold it.
export function PersonSelect({ people, value, onChange, prefer = [], placeholder = 'Select person', disabled, allowEmpty = true, warnLabel }) {
  const preferSet = new Set(prefer.filter(Boolean))
  const top = people.filter(p => preferSet.has(p.id))
  const rest = people.filter(p => !preferSet.has(p.id))
  const warn = warnLabel && value && preferSet.size > 0 && !preferSet.has(value)
  return (
    <div>
      <select className="form-select" value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value || null)}>
        {allowEmpty && <option value="">{placeholder}</option>}
        {top.length > 0 && <optgroup label="On this engagement">{top.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</optgroup>}
        <optgroup label={top.length ? 'Everyone else' : 'People'}>
          {rest.map(p => <option key={p.id} value={p.id}>{p.full_name}{p.employee_id ? ` · ${p.employee_id}` : ''}</option>)}
        </optgroup>
      </select>
      {warn && <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>Not the {warnLabel} on this engagement</div>}
    </div>
  )
}

export function EnumSelect({ options, value, onChange, placeholder = '—', disabled, style, className = '' }) {
  return (
    <select className={`form-select ${className}`} data-v={value || ''} style={style} value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  )
}

export function Field({ label, children, hint, required }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

export function ErrorLine({ error }) {
  if (!error) return null
  return <div className="card" style={{ padding: '10px 12px', marginBottom: 12, color: '#dc2626', fontSize: 13 }}>{error}</div>
}

export function Chip({ children, tone = 'gray', title }) {
  const tones = {
    gray: { bg: 'var(--surface)', fg: 'var(--ink-soft)' },
    red: { bg: '#fef2f2', fg: '#b91c1c' },
    amber: { bg: '#fffbeb', fg: '#b45309' },
    green: { bg: '#ecfdf5', fg: '#047857' },
  }[tone]
  return <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: tones.bg, color: tones.fg, border: '1px solid var(--border)' }}>{children}</span>
}

// Errors from Postgres triggers arrive as plain messages; keep them readable.
// A missing table/function means the database is behind the app (STEP235
// not yet re-run after a change) — say that instead of PostgREST's wording.
export const errText = e => {
  const msg = (e?.message || String(e)).replace(/^.*?ERROR:\s*/, '')
  if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(e?.code) || /schema cache|does not exist/i.test(msg)) {
    return `The database is missing part of the Go-Live Support setup (${msg}). Run the latest sql/STEP235_golive_support.sql and then sql/STEP237_golive_hours_and_reports.sql in the Supabase SQL Editor — both are safe to re-run — then reload this page.`
  }
  return msg
}

// KPI tile for the Devices / Daily Checks strips. Pass onClick to make it a filter.
export function Kpi({ label, value, sub, accent, active, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`gl-kpi${active ? ' on' : ''}`} style={{ '--gl-accent': accent }} onClick={onClick} type={onClick ? 'button' : undefined} aria-pressed={onClick ? !!active : undefined}>
      <div className="gl-kpi-label">{label}</div>
      <div className="gl-kpi-value">{value}</div>
      {sub != null && <div className="gl-kpi-sub">{sub}</div>}
    </Tag>
  )
}

export function Search({ value, onChange, placeholder }) {
  return (
    <div className="gl-search">
      <SearchIcon size={14} />
      <input className="form-input" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

// STEP259 — per-device Go-live flag.
export function GoLiveBadge({ e, compact }) {
  if (e?.is_golive) return <span className="gl-pill green" title={e.golive_since ? `Live since ${e.golive_since}` : 'Go-live: Yes'}>{compact ? 'Live' : 'Go-live'}</span>
  return <span className="gl-pill gray" title="Go-live: No">{compact ? 'Not live' : 'Not live'}</span>
}

// Device filter shared by every tab (state lives on the engagement page, so
// it follows you from tab to tab): Go-live Yes / No plus each custom field.
export function DeviceFilterSelects({ ctx }) {
  const { deviceFilter: df, setDeviceFilter, deviceFields: fields, enrollments } = ctx
  const setField = (k, v) => setDeviceFilter(d => ({ ...d, fields: { ...d.fields, [k]: v } }))
  return (
    <>
      <select className="form-select" value={df.golive} onChange={e => setDeviceFilter(d => ({ ...d, golive: e.target.value }))} aria-label="Go-live" data-on={df.golive ? '1' : undefined}>
        <option value="">Go-live: all</option><option value="YES">Go-live: Yes</option><option value="NO">Go-live: No</option>
      </select>
      {fields.map(f => (
        <select key={f.key} className="form-select" value={df.fields[f.key] || ''} onChange={e => setField(f.key, e.target.value)} aria-label={f.label}>
          <option value="">{f.label}: all</option>
          {filterChoices(f, enrollments).map(v => <option key={v} value={v}>{v}</option>)}
          <option value="__blank">{f.label}: (blank)</option>
        </select>
      ))}
    </>
  )
}

// One line naming the active device filter, with a clear button — for tabs
// whose own toolbar doesn't host the selects.
export function DeviceFilterNote({ ctx, what = 'devices' }) {
  if (!deviceFilterActive(ctx.deviceFilter)) return null
  const { deviceFilter: df, deviceFields: fields } = ctx
  const parts = [df.golive && `Go-live: ${df.golive === 'YES' ? 'Yes' : 'No'}`, ...fields.filter(f => df.fields[f.key]).map(f => `${f.label}: ${df.fields[f.key] === '__blank' ? '(blank)' : df.fields[f.key]}`)].filter(Boolean)
  return (
    <div className="card" style={{ padding: '8px 12px', marginBottom: 12, fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>Showing {what} for <strong>{parts.join(' · ')}</strong></span>
      <button className="btn btn-ghost btn-sm" onClick={() => ctx.setDeviceFilter(EMPTY_DEVICE_FILTER)}>Clear</button>
    </div>
  )
}
