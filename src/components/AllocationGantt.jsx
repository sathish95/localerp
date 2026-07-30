import { ChevronLeft, ChevronRight } from 'lucide-react'

const DAY_PX = 16
const ROW_H = 36
const HEADER_H = 26
const LABEL_W = 150

function daysBetween(a, b) { return Math.round((b - a) / 86400000) }
function fmtShort(d) { return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) }

// Stateless SVG Gantt — parent owns windowStart/weeks and pagination via onShiftWindow.
// rows: [{ id, label, segments: [{ start, end, color, label }] }]  (end=null → open-ended)
export default function AllocationGantt({ rows, windowStart, weeks = 10, onShiftWindow }) {
  const winStart = new Date(windowStart); winStart.setHours(0, 0, 0, 0)
  const totalDays = weeks * 7
  const chartW = totalDays * DAY_PX
  const chartH = HEADER_H + Math.max(rows.length, 1) * ROW_H
  const winEnd = new Date(winStart); winEnd.setDate(winEnd.getDate() + totalDays)

  const weekMarks = Array.from({ length: weeks + 1 }, (_, i) => i)

  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onShiftWindow && onShiftWindow(-weeks)}><ChevronLeft size={14} /></button>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{fmtShort(winStart)} — {fmtShort(winEnd)}</span>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onShiftWindow && onShiftWindow(weeks)}><ChevronRight size={14} /></button>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>Nothing to show in this window</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg width={LABEL_W + chartW} height={chartH} style={{ display: 'block', minWidth: LABEL_W + chartW }}>
            {/* Week gridlines + labels */}
            {weekMarks.map(i => {
              const x = LABEL_W + i * 7 * DAY_PX
              const d = new Date(winStart); d.setDate(d.getDate() + i * 7)
              return (
                <g key={i}>
                  <line x1={x} y1={0} x2={x} y2={chartH} stroke="#f1f5f9" strokeWidth={1} />
                  {i < weeks && <text x={x + 4} y={16} fontSize="10" fill="#94a3b8">{fmtShort(d)}</text>}
                </g>
              )
            })}
            <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={chartH} stroke="#e2e8f0" strokeWidth={1.5} />

            {rows.map((row, ri) => {
              const y = HEADER_H + ri * ROW_H
              return (
                <g key={row.id}>
                  <line x1={0} y1={y + ROW_H} x2={LABEL_W + chartW} y2={y + ROW_H} stroke="#f8fafc" strokeWidth={1} />
                  <text x={8} y={y + ROW_H / 2 + 4} fontSize="11.5" fontWeight="700" fill="#334155">
                    {row.label.length > 20 ? row.label.slice(0, 19) + '…' : row.label}
                  </text>
                  {row.segments.map((seg, si) => {
                    const segStart = new Date(seg.start)
                    const segEnd = seg.end ? new Date(seg.end) : winEnd
                    const clampedStart = segStart < winStart ? winStart : segStart
                    const clampedEnd = segEnd > winEnd ? winEnd : segEnd
                    if (clampedEnd < winStart || clampedStart > winEnd) return null
                    const x = LABEL_W + daysBetween(winStart, clampedStart) * DAY_PX
                    const w = Math.max(daysBetween(clampedStart, clampedEnd) * DAY_PX, 6)
                    return (
                      <g key={si}>
                        <rect x={x} y={y + 6} width={w} height={ROW_H - 14} rx={5} fill={seg.color || '#6366f1'} opacity={0.85}>
                          <title>{seg.label}</title>
                        </rect>
                        {w > 40 && (
                          <text x={x + 6} y={y + ROW_H / 2 + 4} fontSize="10" fill="#fff" fontWeight="700">
                            {seg.label.length > Math.floor(w / 6) ? seg.label.slice(0, Math.floor(w / 6)) + '…' : seg.label}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </svg>
        </div>
      )}
    </div>
  )
}
