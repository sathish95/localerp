import { supabase } from './supabase'

export async function listRevisions(budgetId) {
  const { data } = await supabase.from('budget_revisions')
    .select('*,requester:profiles!requested_by(full_name),reviewer:profiles!reviewed_by(full_name)')
    .eq('budget_id', budgetId).order('revision_number', { ascending: false })
  return data || []
}

export async function proposeRevision(budgetId, currentAllocated, requestedAllocated, reason, requestedBy) {
  const { data: existing } = await supabase.from('budget_revisions').select('revision_number')
    .eq('budget_id', budgetId).order('revision_number', { ascending: false }).limit(1)
  const nextNumber = (existing?.[0]?.revision_number || 0) + 1
  const { error } = await supabase.from('budget_revisions').insert({
    budget_id: budgetId, revision_number: nextNumber,
    previous_allocated: currentAllocated, requested_allocated: requestedAllocated,
    delta: requestedAllocated - currentAllocated, reason, requested_by: requestedBy,
  })
  if (error) throw error
}

// action: 'approve' | 'reject'. Approving writes the new allocated amount onto the
// live budgets row (same read-then-update pattern src/lib/budgetSync.js already
// uses) and logs to the generic approval_logs table.
export async function reviewRevision(revision, action, reviewerId, rejectionReason) {
  const status = action === 'approve' ? 'approved' : 'rejected'
  const { error } = await supabase.from('budget_revisions').update({
    status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString(),
    rejection_reason: action === 'reject' ? (rejectionReason || null) : null,
  }).eq('id', revision.id)
  if (error) throw error

  if (action === 'approve') {
    await supabase.from('budgets').update({ allocated: revision.requested_allocated }).eq('id', revision.budget_id)
  }

  await supabase.from('approval_logs').insert({
    entity_type: 'budget_revision', entity_id: revision.id, performed_by: reviewerId,
    action, from_status: 'pending_review', to_status: status,
    comments: action === 'reject' ? (rejectionReason || null) : null,
  })
}
