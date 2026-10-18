import { ensureXLSX } from './xlsxLoader'
import { dateFmt } from './supabase'

// Excel export for Task Management → Reports. Takes whatever the Reports
// tab has ALREADY computed (the filtered task list + its summary numbers)
// rather than re-deriving anything itself, so the export can never drift
// from what's on screen — it's a straight dump of the current filtered
// view, one row per task, plus a Summary sheet and a sheet documenting
// exactly which filters were active when it was generated.
export async function exportTaskReportExcel({ tasks, projects, departments, stepsForDept, isTaskDone, isOverdue, summary, filterLabels }) {
  await ensureXLSX()
  const XLSX = window.XLSX

  const taskRows = tasks.map(t => {
    const proj = projects.find(p => p.id === t.project_id)
    const dept = departments.find(d => d.id === t.department_id)
    const deptSteps = stepsForDept(t.department_id)
    const step = deptSteps.find(s => s.status_key === t.status)
    return {
      'Task ID': t.task_id || '',
      'Task Name': t.task_name || '',
      'Type': (t.task_type || 'task').replace(/_/g, ' '),
      'Priority': t.priority || '',
      'Status': step?.label || t.status || '',
      'Done': isTaskDone(t) ? 'Yes' : 'No',
      'Overdue': isOverdue(t, deptSteps) ? 'Yes' : 'No',
      'Project': proj?.name || '',
      'Department': dept?.name || '',
      'Assignee': t.assignee?.full_name || '',
      'Module': t.module_name || '',
      'Planned Start': t.planned_start_date || '',
      'Planned End': t.planned_end_date || '',
      'Actual Start': t.actual_start_date || '',
      'Actual End': t.actual_end_date || '',
      'Estimated Hours': t.estimated_hours ?? '',
      'Actual Hours': t.actual_hours ?? '',
      'Progress %': t.progress_pct ?? '',
      'Created': t.created_at ? dateFmt(t.created_at) : '',
    }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(taskRows), 'Tasks')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary')
  if (filterLabels?.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filterLabels.map(f => ({ 'Filter Applied': f }))), 'Filters')
  }

  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `task-report-${stamp}.xlsx`)
}
