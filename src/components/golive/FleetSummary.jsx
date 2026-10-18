import { useState } from 'react'
import { fleetSummary } from '../../lib/goLiveRules'

// Equipment overview (STEP250) — shared by the engagement Overview and the
// public report: the consolidated counts (click one to filter), a row per
// equipment with its device / operation / maintenance / sensor status, and
// the category breakdown. rows: see fleetSummary() in goLiveRules.js, plus
// equipment_id, equipment, device, site, last_check_date, sensors_down_names.

const isMaint = r => !!r.last_maintenance || r.support_status === 'MAINTENANCE'
const TILES = [
  { key: 'devices', group: 'equipment', label: 'Devices deployed', tone: '#6366f1', match: () => true },
  { key: 'workingDevices', group: 'equipment', label: 'Working devices', tone: '#059669', match: r => r.last_result === 'HEALTHY' },
  { key: 'notWorkingDevices', group: 'equipment', label: 'Not working devices', tone: '#dc2626', alert: true, match: r => r.last_result === 'ATTENTION' },
  { key: 'maintenance', group: 'equipment', label: 'Under maintenance', tone: '#d97706', alert: true, match: isMaint },
  { key: 'noOperation', group: 'equipment', label: 'Not operating', tone: '#b91c1c', alert: true, match: r => !isMaint(r) && r.connectivity === 'OFFLINE' },
  { key: 'sensorsInstalled', group: 'sensors', label: 'Sensors installed', tone: '#0ea5e9', match: r => r.sensors_total > 0 },
  { key: 'workingSensors', group: 'sensors', label: 'Working sensors', tone: '#059669', match: r => r.sensors_working > 0 },
  { key: 'notWorkingSensors', group: 'sensors', label: 'Not working sensors', tone: '#dc2626', alert: true, match: r => r.sensors_down > 0 },
  { key: 'sensorsNotInstalled', group: 'sensors', label: 'Sensors not installed', tone: '#d97706', alert: true, match: r => r.sensors_missing > 0 },
]
const SUB = t => ({
  devices: t.noCheck ? `${t.noCheck} with no check yet` : 'All checked',
  sensorsInstalled: t.devices ? `${Math.round((t.sensorsInstalled / t.devices) * 10) / 10} per device` : '',
  workingDevices: t.devices ? `${Math.round((t.workingDevices / t.devices) * 100)}% of devices` : '',
  workingSensors: t.sensorsInstalled ? `${Math.round((t.workingSensors / t.sensorsInstalled) * 100)}% of installed` : '',
  notWorkingDevices: 'Latest check needs attention',
  notWorkingSensors: t.sensorsUnreviewed ? `${t.sensorsUnreviewed} not reviewed yet` : 'Faulty or not working',
  sensorsNotInstalled: 'Defaults for the equipment not fitted',
  maintenance: 'Marked maintenance on the latest check',
  noOperation: 'Operation = No (not in maintenance)',
})
const DEVICE_STATUS = {
  HEALTHY: ['Working', '#047857', '#ecfdf5'],
  ATTENTION: ['Not working', '#b91c1c', '#fef2f2'],
  INCOMPLETE: ['Check incomplete', '#b45309', '#fffbeb'],
}
const Pill = ({ text, fg, bg }) => <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: fg, background: bg, whiteSpace: 'nowrap' }}>{text}</span>
const fmtDate = d => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')

// sensorSummary (optional): [{ sensor, kind, devices, installed, working, not_working, not_reviewed, na }]
export default function FleetSummary({ rows, sensorSummary, compact, withList = true }) {
  const [pick, setPick] = useState('devices')
  const [view, setView] = useState('equipment')
  const [q, setQ] = useState('')
  const { total, categories } = fleetSummary(rows)
  const sub = SUB(total)
  const tile = TILES.find(t => t.key === pick) || TILES[0]
  const t = q.trim().toLowerCase()
  const shown = rows.filter(r => tile.match(r) && (!t || [r.equipment_id, r.equipment, r.category, r.device, r.site].some(v => String(v || '').toLowerCase().includes(t))))
    .sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.equipment_id || a.equipment || '').localeCompare(String(b.equipment_id || b.equipment || '')))

  return (
    <div>
      {[['equipment', 'Equipment'], ['sensors', 'Sensors']].map(([grp, title]) => (
        <div key={grp} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 6 }}>{title}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: 10 }}>
            {TILES.filter(x => x.group === grp).map(x => {
              const on = withList && pick === x.key
              return (
                <button key={x.key} type="button" disabled={!withList} onClick={() => { setPick(x.key); setView('equipment') }} aria-pressed={on}
                  style={{ position: 'relative', textAlign: 'left', font: 'inherit', cursor: withList ? 'pointer' : 'default', background: on ? '#f5f7ff' : '#fff', border: `1.5px solid ${on ? 'var(--c1)' : 'var(--border)'}`, borderRadius: 12, padding: '10px 12px 10px 15px', minWidth: 0 }}>
                  <span style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: '0 3px 3px 0', background: x.tone }} />
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>{x.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.25, color: x.alert && total[x.key] ? x.tone : 'var(--ink)' }}>{total[x.key]}</div>
                  {sub[x.key] && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub[x.key]}</div>}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {!compact && withList && (
        <div style={{ marginTop: 14 }}>
          <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ display: 'inline-flex', border: '1.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {[['equipment', 'Equipment list'], ['category', 'Summary by category'], ...(sensorSummary ? [['sensor', 'Sensor count']] : [])].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setView(k)} style={{ border: 'none', padding: '6px 12px', font: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: view === k ? '#eef2ff' : '#fff', color: view === k ? '#4338ca' : 'var(--ink-muted)' }}>{l}</button>
              ))}
            </div>
            {view === 'equipment' && <input className="form-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search equipment, category, device, site…" style={{ maxWidth: 300, padding: '6px 10px' }} />}
            {view === 'equipment' && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{tile.label}: {shown.length} of {rows.length} equipment{pick !== 'devices' && <> · <button type="button" onClick={() => setPick('devices')} style={{ border: 'none', background: 'none', color: 'var(--c1)', cursor: 'pointer', padding: 0, font: 'inherit' }}>show all</button></>}</span>}
          </div>

          {view === 'equipment' ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ display: 'table', fontSize: 12.5, minWidth: 1100 }}>
                <thead><tr>
                  <th>Equipment ID</th><th>Equipment</th><th>Category</th><th>Device</th><th>Site</th><th>Device status</th><th>Operation</th><th>Maintenance</th>
                  <th>Sensors installed</th><th>Working</th><th>Not working</th><th>Not installed</th><th>Last check</th>
                </tr></thead>
                <tbody>
                  {!shown.length ? <tr><td colSpan={13} style={{ color: 'var(--ink-muted)', textAlign: 'center', padding: 16 }}>No equipment in this group.</td></tr> : shown.map((r, i) => {
                    const st = r.last_result ? DEVICE_STATUS[r.last_result] : null
                    const maint = isMaint(r)
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{r.equipment_id || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{r.equipment || '—'}</td>
                        <td>{r.category}</td>
                        <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, whiteSpace: 'nowrap' }}>{r.device || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{r.site || '—'}</td>
                        <td>{st ? <Pill text={st[0]} fg={st[1]} bg={st[2]} /> : <Pill text="No check" fg="#64748b" bg="#f1f5f9" />}</td>
                        <td>{r.connectivity === 'ONLINE' ? <Pill text="Yes" fg="#047857" bg="#ecfdf5" /> : r.connectivity === 'OFFLINE' ? <Pill text="No" fg={maint ? '#b45309' : '#b91c1c'} bg={maint ? '#fffbeb' : '#fef2f2'} /> : r.connectivity === 'INTERMITTENT' ? <Pill text="Intermittent" fg="#b45309" bg="#fffbeb" /> : '—'}</td>
                        <td>{maint ? <Pill text="Yes" fg="#b45309" bg="#fffbeb" /> : <span style={{ color: 'var(--ink-muted)' }}>No</span>}</td>
                        <td>{r.sensors_total || 0}</td>
                        <td style={{ color: r.sensors_working ? '#047857' : undefined, fontWeight: 600 }}>{r.sensors_working || 0}</td>
                        <td style={{ color: r.sensors_down ? '#b91c1c' : undefined, fontWeight: 600 }}>{r.sensors_down || 0}{r.sensors_down > 0 && r.sensors_down_names && <div style={{ fontSize: 10.5, fontWeight: 400, maxWidth: 200, whiteSpace: 'normal' }}>{r.sensors_down_names}</div>}</td>
                        <td style={{ color: r.sensors_missing ? '#b45309' : undefined, fontWeight: 600 }}>{r.sensors_missing || 0}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.last_check_date)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : view === 'category' ? (
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Equipment summary</div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ display: 'table', fontSize: 12.5, minWidth: 640 }}>
                    <thead><tr><th>Equipment category</th><th>Devices</th><th>Working</th><th>Not working</th><th>No check yet</th><th>Under maintenance</th><th>Not operating</th></tr></thead>
                    <tbody>
                      {categories.map(c => (
                        <tr key={c.category}>
                          <td style={{ fontWeight: 700 }}>{c.category}</td><td>{c.devices}</td>
                          <td style={{ color: '#047857' }}>{c.workingDevices}</td><td style={{ color: c.notWorkingDevices ? '#b91c1c' : undefined }}>{c.notWorkingDevices}</td>
                          <td style={{ color: 'var(--ink-muted)' }}>{c.noCheck}</td><td>{c.maintenance}</td><td style={{ color: c.noOperation ? '#b91c1c' : undefined }}>{c.noOperation}</td>
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 800, background: '#f8fafc' }}>
                        <td>Total</td><td>{total.devices}</td><td>{total.workingDevices}</td><td>{total.notWorkingDevices}</td><td>{total.noCheck}</td><td>{total.maintenance}</td><td>{total.noOperation}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Sensor count by equipment category</div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ display: 'table', fontSize: 12.5, minWidth: 640 }}>
                    <thead><tr><th>Equipment category</th><th>Sensors installed</th><th>Working</th><th>Not working</th><th>Not reviewed</th><th>Not installed</th></tr></thead>
                    <tbody>
                      {categories.map(c => (
                        <tr key={c.category}>
                          <td style={{ fontWeight: 700 }}>{c.category}</td><td>{c.sensorsInstalled}</td>
                          <td style={{ color: '#047857' }}>{c.workingSensors}</td><td style={{ color: c.notWorkingSensors ? '#b91c1c' : undefined }}>{c.notWorkingSensors}</td>
                          <td style={{ color: c.sensorsUnreviewed ? '#b45309' : undefined }}>{c.sensorsUnreviewed}</td><td style={{ color: c.sensorsNotInstalled ? '#b45309' : undefined }}>{c.sensorsNotInstalled}</td>
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 800, background: '#f8fafc' }}>
                        <td>Total</td><td>{total.sensorsInstalled}</td><td>{total.workingSensors}</td><td>{total.notWorkingSensors}</td><td>{total.sensorsUnreviewed}</td><td>{total.sensorsNotInstalled}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (() => {
            // sensor perspective: one row per sensor, grouped by sensor type
            const kinds = [...new Set((sensorSummary || []).map(x => x.kind || 'Other'))]
            const sumOf = (items, k) => items.reduce((n, x) => n + Number(x[k] || 0), 0)
            const COLS = ['devices', 'installed', 'working', 'not_working', 'not_reviewed', 'na']
            return !sensorSummary?.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No sensors mapped.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ display: 'table', fontSize: 12.5, minWidth: 640 }}>
                  <thead><tr><th>Sensor</th><th>Devices fitted</th><th>Installed</th><th>Working</th><th>Not working</th><th>Not reviewed</th><th>N/A</th></tr></thead>
                  <tbody>
                    {kinds.map(k => {
                      const items = sensorSummary.filter(x => (x.kind || 'Other') === k)
                      return [
                        <tr key={`h-${k}`} style={{ background: '#f1f5f9', fontWeight: 800 }}>
                          <td style={{ textTransform: 'uppercase', fontSize: 11.5, letterSpacing: '.04em' }}>{k}</td>
                          {COLS.map(c => <td key={c}>{sumOf(items, c)}</td>)}
                        </tr>,
                        ...items.map(x => (
                          <tr key={`${k}-${x.sensor}`}>
                            <td style={{ paddingLeft: 22 }}>{x.sensor}</td><td>{x.devices}</td><td style={{ fontWeight: 700 }}>{x.installed}</td>
                            <td style={{ color: x.working ? '#047857' : undefined }}>{x.working}</td><td style={{ color: x.not_working ? '#b91c1c' : undefined, fontWeight: x.not_working ? 700 : 400 }}>{x.not_working}</td>
                            <td style={{ color: x.not_reviewed ? '#b45309' : undefined }}>{x.not_reviewed}</td><td style={{ color: 'var(--ink-muted)' }}>{x.na}</td>
                          </tr>
                        )),
                      ]
                    })}
                    <tr style={{ fontWeight: 800, background: '#e2e8f0' }}>
                      <td>Total</td>{COLS.map(c => <td key={c}>{sumOf(sensorSummary, c)}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
