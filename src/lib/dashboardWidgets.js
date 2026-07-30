import { SprintProgressWidget, TaskStatusBreakdownWidget, MilestoneProgressWidget } from '../components/dashboard-widgets/ProjectWidgets'
import { BudgetHealthWidget, SpendInPeriodWidget } from '../components/dashboard-widgets/FinanceWidgets'
import { ProcurementPipelineWidget, RequestsInPeriodWidget } from '../components/dashboard-widgets/ProcurementWidgets'
import { ResourceUtilizationWidget, TeamHoursSummaryWidget } from '../components/dashboard-widgets/ResourceWidgets'

// Widget catalog — metadata shown in the "+ Add Widget" picker, grouped by category.
export const WIDGET_CATALOG = [
  { id: 'sprint_progress', category: 'project', label: 'Sprint Progress', icon: '🏃', defaultW: 4, defaultH: 7 },
  { id: 'task_status_breakdown', category: 'project', label: 'Task Status Breakdown', icon: '📋', defaultW: 4, defaultH: 6 },
  { id: 'milestone_progress', category: 'project', label: 'Milestone Progress', icon: '🏁', defaultW: 4, defaultH: 6 },
  { id: 'budget_health', category: 'finance', label: 'Budget Health', icon: '💳', defaultW: 6, defaultH: 6 },
  { id: 'spend_in_period', category: 'finance', label: 'Spend in Period', icon: '🧾', defaultW: 6, defaultH: 6 },
  { id: 'procurement_pipeline', category: 'procurement', label: 'Procurement Pipeline', icon: '🛒', defaultW: 6, defaultH: 6 },
  { id: 'requests_in_period', category: 'procurement', label: 'Requests in Period', icon: '🔄', defaultW: 6, defaultH: 4 },
  { id: 'resource_utilization', category: 'resource', label: 'Resource Utilization', icon: '👥', defaultW: 4, defaultH: 7 },
  { id: 'team_hours_summary', category: 'resource', label: 'Team Hours Summary', icon: '⏱', defaultW: 4, defaultH: 6 },
]

export const WIDGET_CATEGORIES = [
  { id: 'project', label: 'Project', icon: '📁', color: '#6366f1' },
  { id: 'finance', label: 'Finance', icon: '💰', color: '#059669' },
  { id: 'procurement', label: 'Procurement', icon: '🛒', color: '#0891b2' },
  { id: 'resource', label: 'Resource', icon: '👥', color: '#7c3aed' },
]

export const WIDGET_COMPONENTS = {
  sprint_progress: SprintProgressWidget,
  task_status_breakdown: TaskStatusBreakdownWidget,
  milestone_progress: MilestoneProgressWidget,
  budget_health: BudgetHealthWidget,
  spend_in_period: SpendInPeriodWidget,
  procurement_pipeline: ProcurementPipelineWidget,
  requests_in_period: RequestsInPeriodWidget,
  resource_utilization: ResourceUtilizationWidget,
  team_hours_summary: TeamHoursSummaryWidget,
}

export function widgetMeta(widgetType) {
  return WIDGET_CATALOG.find(w => w.id === widgetType)
}
