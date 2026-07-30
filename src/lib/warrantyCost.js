import { supabase } from './supabase'

// Warranty cost for a project: sums warranty_cost_entries (Hardware +
// Software) for claims whose device_warranty.project_id matches, within a
// date window. Mirrors actualCost.js's computeHardwareCostForProject shape
// so recomputeForProject() can call this the same way it calls the other
// two cost computers.
//
// warranty_cost_entries carries restrictive RLS (admin/ceo/finance only,
// same as profit_margins) — callers outside that role set simply get 0
// back here, not an error, matching getMargin()'s "graceful empty state
// either way" convention.
export async function computeWarrantyCostForProject(projectId, periodStart, periodEnd) {
  const { data: warranties } = await supabase.from('device_warranties').select('id').eq('project_id', projectId)
  const warrantyIds = (warranties || []).map(w => w.id)
  if (!warrantyIds.length) return { hardwareCost: 0, softwareCost: 0, totalWarrantyCost: 0 }

  const { data: claims } = await supabase.from('warranty_claims').select('id').in('device_warranty_id', warrantyIds)
  const claimIds = (claims || []).map(c => c.id)
  if (!claimIds.length) return { hardwareCost: 0, softwareCost: 0, totalWarrantyCost: 0 }

  const startISO = periodStart.toISOString().slice(0, 10)
  const endISO = periodEnd.toISOString().slice(0, 10)
  const { data: entries } = await supabase.from('warranty_cost_entries').select('cost_type,amount,incurred_date')
    .in('warranty_claim_id', claimIds).gte('incurred_date', startISO).lte('incurred_date', endISO)

  const hardwareCost = (entries || []).filter(e => e.cost_type === 'Hardware').reduce((s, e) => s + Number(e.amount || 0), 0)
  const softwareCost = (entries || []).filter(e => e.cost_type === 'Software').reduce((s, e) => s + Number(e.amount || 0), 0)
  return {
    hardwareCost: Math.round(hardwareCost * 100) / 100,
    softwareCost: Math.round(softwareCost * 100) / 100,
    totalWarrantyCost: Math.round((hardwareCost + softwareCost) * 100) / 100,
  }
}

export async function getWarrantyCostSummaryForProject(projectId) {
  const { data: warranties } = await supabase.from('device_warranties').select('id').eq('project_id', projectId)
  const warrantyIds = (warranties || []).map(w => w.id)
  if (!warrantyIds.length) return { claimCount: 0, hardwareCost: 0, softwareCost: 0, totalWarrantyCost: 0 }

  const { data: claims } = await supabase.from('warranty_claims').select('id').in('device_warranty_id', warrantyIds)
  const claimIds = (claims || []).map(c => c.id)

  const lifeStart = new Date(2000, 0, 1) // effectively "all time" — warranty cost has no natural project start bound beyond deployment
  const totals = await computeWarrantyCostForProject(projectId, lifeStart, new Date())
  return { claimCount: claimIds.length, ...totals }
}
