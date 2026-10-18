import { supabase } from './supabase'
import { updateResourcePlan, updateHardwareLine, updateSoftwareLine, updateTimelinePhase, computeValueSummary } from './proposals'

export function shareLinkUrl(token) {
  return `${window.location.origin}/proposal-view/${token}`
}

export async function getOrCreateShareLink(proposalId, profileId) {
  const { data: existing, error: findErr } = await supabase.from('proposal_share_links')
    .select('*').eq('proposal_id', proposalId).is('revoked_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (findErr) throw findErr
  if (existing) return existing
  const { data, error } = await supabase.from('proposal_share_links')
    .insert({ proposal_id: proposalId, created_by: profileId }).select().single()
  if (error) throw error
  return data
}

export async function listShareLinks(proposalId) {
  const { data, error } = await supabase.from('proposal_share_links')
    .select('*').eq('proposal_id', proposalId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function setShareLinkExpiry(linkId, expiresAt) {
  const { error } = await supabase.from('proposal_share_links').update({ expires_at: expiresAt || null }).eq('id', linkId)
  if (error) throw error
}

export async function revokeShareLink(linkId) {
  const { error } = await supabase.from('proposal_share_links').update({ revoked_at: new Date().toISOString() }).eq('id', linkId)
  if (error) throw error
}

export async function listChangeRequests(proposalId) {
  const { data, error } = await supabase.from('proposal_change_requests')
    .select('*, reviewer:reviewed_by(full_name)').eq('proposal_id', proposalId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Approving replays each change through the SAME update* functions the
// authenticated editor UI uses (never a separate write path) — so a
// client-proposed qty change gets exactly the same cost recompute
// (rate_used, subtotal_internal_cost, computed_cost) as if a proposal
// owner had typed it in directly. Rejecting just closes the request out.
export async function reviewChangeRequest(requestId, { approve, note, profileId }) {
  const { data: req, error } = await supabase.from('proposal_change_requests').select('*').eq('id', requestId).single()
  if (error) throw error
  if (req.status !== 'pending') throw new Error('This request has already been reviewed.')

  if (approve) {
    for (const c of req.changes || []) {
      if (c.type === 'resource') {
        const { data: row } = await supabase.from('proposal_resource_plans').select('*').eq('id', c.id).maybeSingle()
        if (!row) continue
        await updateResourcePlan(c.id, {
          designation: row.designation, employeeId: row.employee_id,
          estimatedCount: c.qty ?? row.estimated_count,
          estimatedDurationWeeks: c.duration_weeks ?? row.estimated_duration_weeks,
          notes: row.notes, refreshRate: false,
        })
      } else if (c.type === 'hardware') {
        const { data: row } = await supabase.from('proposal_hardware_lines').select('*').eq('id', c.id).maybeSingle()
        if (!row) continue
        await updateHardwareLine(c.id, {
          partNumber: row.part_number, description: row.description,
          estimatedQuantity: c.qty ?? row.estimated_quantity,
          manualUnitCost: row.unit_cost, notes: row.notes, refreshCost: false,
        })
      } else if (c.type === 'software') {
        const { data: row } = await supabase.from('proposal_software_lines').select('*').eq('id', c.id).maybeSingle()
        if (!row) continue
        await updateSoftwareLine(c.id, {
          itemName: row.item_name, costType: row.cost_type, unitCost: row.unit_cost,
          qty: c.qty ?? row.qty, durationMonths: row.duration_months, notes: row.notes,
        })
      } else if (c.type === 'timeline') {
        const { data: row } = await supabase.from('proposal_timeline').select('*').eq('id', c.id).maybeSingle()
        if (!row) continue
        await updateTimelinePhase(c.id, {
          phaseName: row.phase_name,
          startOffsetWeeks: c.start_offset_weeks ?? row.start_offset_weeks,
          durationWeeks: c.duration_weeks ?? row.duration_weeks,
          linkedResourcePlanIds: row.linked_resource_plan_ids, sortOrder: row.sort_order,
        })
      }
    }
    await computeValueSummary(req.proposal_id, { force: true })
  }

  const { error: updErr } = await supabase.from('proposal_change_requests').update({
    status: approve ? 'approved' : 'rejected', reviewed_by: profileId, reviewed_at: new Date().toISOString(), review_note: note || null,
  }).eq('id', requestId)
  if (updErr) throw updErr
}

/* ── Public (anon) side — used only by PublicProposalSharePage ── */

export async function fetchPublicProposal(token) {
  const { data, error } = await supabase.rpc('get_proposal_public', { p_token: token })
  if (error) throw error
  return data
}

export async function submitProposalChangeRequest(token, { clientName, clientNote, changes }) {
  const { data, error } = await supabase.rpc('submit_proposal_change_request', {
    p_token: token, p_client_name: clientName || null, p_client_note: clientNote || null, p_changes: changes,
  })
  if (error) throw error
  return data
}
