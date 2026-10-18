// "Who has work planned for <day>?" — the pure calculation behind
// Resource Management → Work Planning (src/lib/resourcePlanning.js) and the
// Manager team report email ("Tomorrow" section). No imports, no clock:
// isTaskDone and the day are passed in, so it runs in the browser and Deno.
//
// A task counts as planned for a day when it's still open and the day falls
// inside planned_start_date..planned_end_date (one date only = single-day
// task). Open tasks already past their end date are "carry-over".

const d2n = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
const n2d = n => new Date(n).toISOString().slice(0, 10)
const isWeekend = s => [0, 6].includes(new Date(d2n(s)).getUTCDay())

export function nextWorkingDayAfter(day) {
  let n = d2n(day)
  do n += 86400000; while (isWeekend(n2d(n)))
  return n2d(n)
}

// Weekdays in [a, b] (at least 1) — spreads a multi-day task's estimate evenly.
function weekdaySpan(a, b) {
  let k = 0
  for (let n = d2n(a); n <= d2n(b); n += 86400000) if (!isWeekend(n2d(n))) k++
  return Math.max(1, k)
}

export const PLAN_STATUS = {
  none:      { label: 'No work planned', color: '#dc2626', bg: '#fef2f2' },
  carryover: { label: 'Only overdue work', color: '#d97706', bg: '#fffbeb' },
  under:     { label: 'Under-planned', color: '#d97706', bg: '#fffbeb' },
  planned:   { label: 'Planned', color: '#059669', bg: '#f0fdf4' },
  leave:     { label: 'On leave', color: '#64748b', bg: '#f8fafc' },
}

/**
 * underPlannedPct: estimated hours for the day below this % of targetHours
 * = "under-planned" (unestimated tasks never make a resource look
 * under-planned on their own).
 */
export function computeWorkPlanCore({ day, employees, tasks, leaves, isTaskDone, targetHours = 8, underPlannedPct = 50 }) {
  const open = tasks.filter(t => t.assigned_to && !isTaskDone(t))
  const rows = employees.map(emp => {
    const mine = open.filter(t => t.assigned_to === emp.id)
    const planned = [], carryover = [], unscheduled = []
    for (const t of mine) {
      const start = t.planned_start_date || t.planned_end_date
      const end = t.planned_end_date || t.planned_start_date
      if (!start) { unscheduled.push(t); continue }
      if (start <= day && day <= end) planned.push({ ...t, dayHours: t.estimated_hours ? Number(t.estimated_hours) / weekdaySpan(start, end) : null })
      else if (end < day) carryover.push(t)
    }
    const onLeave = leaves.some(l => l.employee_id === emp.id && l.leave_type !== 'permission' && l.from_date <= day && day <= (l.to_date || l.from_date))
    const estimated = planned.filter(t => t.dayHours != null)
    const plannedHours = estimated.reduce((s, t) => s + t.dayHours, 0)
    const hasUnestimated = planned.length > estimated.length
    let status
    if (onLeave) status = 'leave'
    else if (planned.length === 0) status = carryover.length ? 'carryover' : 'none'
    else if (!hasUnestimated && plannedHours < targetHours * underPlannedPct / 100) status = 'under'
    else status = 'planned'
    return {
      id: emp.id, name: emp.full_name, role: emp.role, department_id: emp.department_id,
      status, onLeave, planned, carryover, unscheduled, plannedHours, hasUnestimated,
      loadPct: targetHours ? (plannedHours / targetHours) * 100 : null,
    }
  })
  const count = s => rows.filter(r => r.status === s).length
  return {
    day, rows,
    summary: {
      resources: rows.length, none: count('none'), carryover: count('carryover'), under: count('under'),
      planned: count('planned'), leave: count('leave'),
      needsPlanning: count('none') + count('carryover') + count('under'),
      unscheduledTasks: rows.reduce((s, r) => s + r.unscheduled.length, 0),
    },
  }
}
