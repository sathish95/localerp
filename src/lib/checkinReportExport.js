import { ensureXLSX } from './xlsxLoader'
import { dateFmt } from './supabase'
import { fmtMinutes } from './checkinKpi'

const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''

// Excel export for Resource Management → Check-In Report. Takes whatever
// the report tab has already fetched and filtered (date range, department,
// resource, status) so the export is a straight dump of the current
// on-screen view — never re-derives or re-queries anything itself.
export async function exportCheckinReportExcel({ logs, departments, fromDate, toDate, kpiRows = [], lateAfter, targetHours }) {
  await ensureXLSX()
  const XLSX = window.XLSX

  const rows = logs.map(l => ({
    'Date': l.work_date ? dateFmt(l.work_date) : '',
    'Employee': l.employee?.full_name || '',
    'Department': departments.find(d => d.id === l.employee?.department_id)?.name || '',
    'Project': l.project?.name || '',
    'Check In': fmtTime(l.check_in),
    'Check Out': l.check_out ? fmtTime(l.check_out) : 'Still checked in',
    'Hours': l.hours_worked ?? '',
    'Work Done': l.comment || '',
  }))

  const r1 = n => n == null ? '' : Math.round(n * 10) / 10
  const kpiSheet = kpiRows.map(k => ({
    'Resource': k.name || '',
    'Role': k.role || '',
    'Department': departments.find(d => d.id === k.department_id)?.name || '',
    'Days Present': k.presentDays,
    'Expected Days': k.expectedDays,
    'Attendance %': k.attendancePct == null ? '' : Math.round(k.attendancePct),
    'Absent Days': k.absentDays,
    'Leave Days': k.leaveDays,
    'Total Hours': r1(k.totalHours),
    'Avg Hours/Day': r1(k.avgHoursPerDay),
    'Avg Check In': k.avgFirstIn == null ? '' : fmtMinutes(k.avgFirstIn),
    'Avg Check Out': k.avgLastOut == null ? '' : fmtMinutes(k.avgLastOut),
    [`Late Days (after ${lateAfter})`]: k.lateDays,
    [`Short Days (<${targetHours}h)`]: k.shortDays,
    'Missed Check-outs': k.missedCheckouts,
    'On Project %': k.projectPct == null ? '' : Math.round(k.projectPct),
  }))

  const wb = XLSX.utils.book_new()
  if (kpiSheet.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiSheet), 'Resource KPIs')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Check-In Report')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 'From': fromDate, 'To': toDate, 'Total Entries': logs.length }]), 'Summary')

  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `checkin-report-${fromDate}_to_${toDate}-${stamp}.xlsx`)
}
