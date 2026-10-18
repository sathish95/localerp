import { supabase } from './supabase'
import { sendNotif } from './notifications'

// Wiki "action items" (STEP205) — typing `/task <description>` on its own
// line in a wiki page and pressing Enter creates a project_tasks row
// directly, via src/components/wiki/actionItemExtension.js's Enter
// keyboard-shortcut handler. Deliberately a minimal direct insert (same
// convention as workItems.js's createTaskForWorkItem) rather than reusing
// TasksPage.jsx's saveTask()/TaskForm, which are private to that page.
export async function createTaskFromActionItem({ pageId, projectId, taskName, assignedTo, organizationId, createdBy }) {
  const { data, error } = await supabase.from('project_tasks').insert({
    task_name: taskName,
    task_type: 'task',
    status: 'backlog',
    priority: 'medium',
    project_id: projectId || null,
    assigned_to: assignedTo || null,
    organization_id: organizationId,
    created_by: createdBy,
    source_wiki_page_id: pageId,
  }).select('id,task_id').single()
  if (error) throw error

  if (assignedTo && assignedTo !== createdBy) {
    sendNotif(assignedTo, {
      type: 'task_assigned', title: '📋 New task assigned to you', body: taskName,
      link: `/tasks?taskId=${data.id}`, senderId: createdBy,
    })
  }
  return data
}
