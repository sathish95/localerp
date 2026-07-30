import { supabase } from './supabase'
import { getProposal, getCostSections, getValueSummary, listTimeline, getBudgetCategoryMap } from './proposals'

// On Won → Convert to Project: returns a PRE-FILLED draft, never a
// finalized budget. Uses INTERNAL COST ONLY for planned budget fields —
// the customer-facing markup never leaks into what the company itself
// plans to spend. Every seeded row is tagged source='proposal' +
// source_proposal_id so it's traceable back to the exact line that
// produced it, and nothing here is a real commitment until PM/Finance
// review it and push it through the existing, separate project budget
// approval chain (PM → CTO → Finance → CEO) — proposal approval and
// budget approval remain two distinct gates.
export async function convertToProject(proposalId, projectId, userId) {
  const [proposal, sections, summary, timeline, categoryMap] = await Promise.all([
    getProposal(proposalId), getCostSections(proposalId), getValueSummary(proposalId),
    listTimeline(proposalId), getBudgetCategoryMap(),
  ])
  if (proposal.status !== 'Won') throw new Error('Only a Won proposal can be converted to a project')
  if (!summary) throw new Error('No value summary computed yet for this proposal')

  // Aggregate each proposal cost section's internal cost into its mapped
  // planned-budget category — several proposal categories can map to the
  // same budget category (App/Firmware/Hardware-Design all → resource cost).
  const byBudgetCategory = {}
  for (const section of sections) {
    const budgetCategory = categoryMap[section.category]
    if (!budgetCategory) continue // unmapped category — skip rather than guess
    const internal = (summary.cost_by_category || []).find(c => c.category === section.category)?.internalCost || 0
    byBudgetCategory[budgetCategory] = (byBudgetCategory[budgetCategory] || 0) + internal
  }

  const plannedRows = Object.entries(byBudgetCategory).map(([category, planned_amount]) => ({
    project_id: projectId, category, planned_amount, source: 'proposal', source_proposal_id: proposalId,
    notes: `From proposal ${proposal.proposal_number} v${proposal.version}`, created_by: userId,
  }))
  if (plannedRows.length) {
    const { error } = await supabase.from('project_planned_budget').upsert(plannedRows, { onConflict: 'project_id,category' })
    if (error) throw error
  }

  // Timeline phases → initial milestones. Budget on each milestone is the
  // REVENUE side (customer price), matching "Proposal.cost_by_phase seeds
  // initial Milestones" — planned cost lives in project_planned_budget
  // above, not here.
  const today = new Date()
  const milestoneRows = timeline.map(phase => {
    const phaseSummary = (summary.cost_by_phase || []).find(p => p.phase === phase.phase_name)
    const start = new Date(today); start.setDate(start.getDate() + Number(phase.start_offset_weeks || 0) * 7)
    const due = new Date(start); due.setDate(due.getDate() + Number(phase.duration_weeks || 1) * 7)
    return {
      project_id: projectId, title: phase.phase_name,
      description: `Seeded from proposal ${proposal.proposal_number} timeline`,
      start_date: start.toISOString().slice(0, 10), due_date: due.toISOString().slice(0, 10),
      budget: phaseSummary?.customerPrice || 0, status: 'pending', created_by: userId,
    }
  })
  if (milestoneRows.length) {
    const { error } = await supabase.from('project_milestones').insert(milestoneRows)
    if (error) throw error
  }

  await supabase.from('proposals').update({ linked_project_id: projectId }).eq('id', proposalId)

  return { plannedBudgetRows: plannedRows.length, milestoneRows: milestoneRows.length }
}

// One-click "Convert to Project" — creates the bare project record from the
// proposal's own header (matching an existing customer by name if one
// exists), then seeds it via convertToProject() above. Splitting these two
// is deliberate: convertToProject() alone is what you'd call again if you
// ever needed to re-seed an existing project from a re-approved proposal.
export async function createProjectFromProposal(proposalId, userId) {
  const proposal = await getProposal(proposalId)
  if (proposal.status !== 'Won') throw new Error('Only a Won proposal can be converted to a project')
  if (proposal.linked_project_id) throw new Error('This proposal is already linked to a project')

  const { data: customer } = await supabase.from('customers').select('id').ilike('name', proposal.customer_name).maybeSingle()

  const { data: project, error } = await supabase.from('projects').insert({
    name: proposal.proposal_name, code: 'PRJ-' + Date.now().toString().slice(-6),
    description: `Converted from proposal ${proposal.proposal_number} (${proposal.customer_name})`,
    budget: 0, reserved_budget: 0, start_date: new Date().toISOString().slice(0, 10),
    status: 'active', customer_id: customer?.id || null, created_by: userId,
  }).select().single()
  if (error) throw error

  const seeded = await convertToProject(proposalId, project.id, userId)
  return { project, ...seeded }
}
