const LABEL_W = 220
const ROW_H = 36
const HEADER_H = 32

const MS_DAY = 86400000
const d = s => { if (!s) return null; const dt = new Date(s); return isNaN(dt) ? null : dt }
const daysBetween = (a, b) => Math.round((b - a) / MS_DAY)

function pxPerDay(totalDays) {
  if (totalDays <= 45) return 22
  if (totalDays <= 120) return 10
  if (totalDays <= 270) return 6
  if (totalDays <= 545) return 3
  return 1.5
}

function monthTicks(start, end, scale) {
  const ticks = []
  let cur = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cur <= end) {
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    const segStart = cur < start ? start : cur
    const segEnd = next < end ? next : end
    const left = daysBetween(start, segStart) * scale
    const width = Math.max(daysBetween(segStart, segEnd) * scale, 1)
    ticks.push({ key: cur.toISOString(), left, width, label: cur.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) })
    cur = next
  }
  return ticks
}

/**
 * groups: [{ title, rows: [{ id, label, sub, start, end, progress, color }] }]
 * Rows with an unparseable start/end are rendered label-only, no bar.
 */
export default function GanttChart({ groups }) {
  const allRows = groups.flatMap(g => g.rows)
  const dated = allRows.map(r => ({ ...r, s: d(r.start), e: d(r.end) })).filter(r => r.s && r.e && r.e >= r.s)

  if (dated.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No dated tasks or milestones to plot yet — set planned start/end dates to see them here.</div>
  }

  let rangeStart = new Date(Math.min(...dated.map(r => r.s)))
  let rangeEnd = new Date(Math.max(...dated.map(r => r.e)))
  rangeStart = new Date(rangeStart.getTime() - 3 * MS_DAY)
  rangeEnd = new Date(rangeEnd.getTime() + 3 * MS_DAY)
  const totalDays = Math.max(daysBetween(rangeStart, rangeEnd), 1)
  const scale = pxPerDay(totalDays)
  const chartW = totalDays * scale
  const ticks = monthTicks(rangeStart, rangeEnd, scale)
  const today = new Date()
  const todayLeft = today >= rangeStart && today <= rangeEnd ? daysBetween(rangeStart, today) * scale : null

  const sticky = { position: 'sticky', left: 0, zIndex: 2, background: 'var(--surface)', flexShrink: 0, width: LABEL_W, boxSizing: 'border-box' }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
      <div style={{ position: 'relative', minWidth: LABEL_W + chartW }}>
        {todayLeft != null && (
          <div style={{ position: 'absolute', top: HEADER_H, bottom: 0, left: LABEL_W + todayLeft, width: 1, background: 'var(--rose)', zIndex: 1 }} title="Today" />
        )}

        {/* header */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <div style={{ ...sticky, height: HEADER_H, display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', borderRight: '1px solid var(--border)', paddingLeft: 12 }}>Task</div>
          <div style={{ position: 'relative', width: chartW, height: HEADER_H }}>
            {ticks.map(t => (
              <div key={t.key} style={{ position: 'absolute', left: t.left, width: t.width, top: 0, bottom: 0, borderLeft: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', paddingLeft: 5, paddingTop: 8, boxSizing: 'border-box' }}>{t.label}</div>
            ))}
          </div>
        </div>

        {groups.map(g => g.rows.length > 0 && (
          <div key={g.title}>
            <div style={{ display: 'flex', background: 'var(--bg-3)' }}>
              <div style={{ ...sticky, height: 26, display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 700, borderRight: '1px solid var(--border)', paddingLeft: 12, background: 'var(--bg-3)' }}>{g.title}</div>
              <div style={{ width: chartW, height: 26 }} />
            </div>
            {g.rows.map(r => {
              const s = d(r.start), e = d(r.end)
              const hasDates = s && e && e >= s
              const left = hasDates ? Math.max(daysBetween(rangeStart, s) * scale, 0) : 0
              const width = hasDates ? Math.max(daysBetween(s, e) * scale, 4) : 0
              const color = r.color || '#6366f1'
              return (
                <div key={r.id} style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
                  <div style={{ ...sticky, height: ROW_H, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRight: '1px solid var(--border)', paddingLeft: 12, paddingRight: 8, boxSizing: 'border-box' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                    {r.sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sub}</div>}
                  </div>
                  <div style={{ position: 'relative', width: chartW, height: ROW_H }}>
                    {hasDates ? (
                      <div title={`${r.label}: ${r.start} → ${r.end}`} style={{ position: 'absolute', left, width, top: 8, height: 20, borderRadius: 6, background: `${color}25`, border: `1.5px solid ${color}` }}>
                        <div style={{ height: '100%', width: `${Math.min(Math.max(r.progress || 0, 0), 100)}%`, background: color, borderRadius: 5, opacity: .85 }} />
                      </div>
                    ) : (
                      <div style={{ position: 'absolute', left: 8, top: 0, height: ROW_H, display: 'flex', alignItems: 'center', fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>no dates set</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
