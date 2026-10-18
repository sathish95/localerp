import { ensureXLSX } from './xlsxLoader'

// Excel export for Capacity → Allocation Chart. Three sheets, all built from
// numbers ALREADY computed on screen (never re-derived here) so the export
// can never drift from what management is looking at when they click Export:
//   - Resource Allocation: the full grid, one row per resource
//   - Project Summary: the PMO/client-facing rollup (headcount, days, cost,
//     budget, % used) per project
//   - Summary: month-level KPIs
export async function exportAllocationChartExcel({ monthLabel, workingDays, gridRows, visibleProjectIds, projectMap, projectSummaryRows, orgKpis }) {
  await ensureXLSX()
  const XLSX = window.XLSX

  const resourceRows = gridRows.map(r => {
    const row = {
      'Resource': r.emp.full_name,
      'Leave Taken': r.leaveTaken,
      'Available Days': r.availableDays,
    }
    visibleProjectIds.forEach((pid, i) => { row[projectMap[pid]?.name || pid] = r.projectDays[i] })
    row['Total Days'] = r.total
    row['Variance'] = r.variance
    row['Utilized %'] = r.utilizedPct
    row['Available %'] = r.availablePct
    row['Cost (₹)'] = r.cost
    return row
  })

  const summaryRows = projectSummaryRows.map(p => ({
    'Project': p.name,
    'Resources Allocated': p.headcount,
    'Total Days': p.totalDays,
    'Cost (₹)': p.cost,
    'Budget (₹)': p.budget || '',
    '% Budget Used': p.pctUsed ?? '',
  }))

  const kpiRows = [
    { Metric: 'Month', Value: monthLabel },
    { Metric: 'Working Days', Value: workingDays },
    { Metric: 'Headcount', Value: orgKpis.headcount },
    { Metric: 'Total Allocated Days', Value: orgKpis.totalDays },
    { Metric: 'Total Available Days', Value: orgKpis.availableDays },
    { Metric: 'Utilization %', Value: orgKpis.utilization },
    { Metric: 'Total People Cost (₹)', Value: orgKpis.cost },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resourceRows), 'Resource Allocation')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Project Summary')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiRows), 'Summary')

  const stamp = monthLabel.replace(/\s+/g, '-')
  XLSX.writeFile(wb, `allocation-chart-${stamp}.xlsx`)
}
