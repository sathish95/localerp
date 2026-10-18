import { supabase } from './supabase'

// STEP227 — org-wide Task Detail presentation: "modal" (the original,
// centered dialog) or "drawer" (Template 1, slides in from the right).
// One row per org; a missing row means the org never changed it, so
// callers default to 'modal'.
export async function getTaskDetailViewStyle() {
  const { data, error } = await supabase.from('task_view_settings').select('detail_view_style').maybeSingle()
  if (error) throw error
  return data?.detail_view_style || 'modal'
}

export async function setTaskDetailViewStyle(style, organizationId) {
  const { error } = await supabase.from('task_view_settings')
    .upsert({ organization_id: organizationId, detail_view_style: style, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
  if (error) throw error
}
