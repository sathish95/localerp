/**
 * Budget commit/spend sync helpers for the Procurement module.
 * Read-then-update client pattern (no DB transaction/RPC) — same known
 * race-condition limitation as other budget-touching flows in this app;
 * acceptable at this scale.
 */
import { supabase } from './supabase'

export async function getBudget(budgetId) {
  if (!budgetId) return null
  const { data } = await supabase.from('budgets').select('*').eq('id', budgetId).single()
  return data || null
}

export function availableBudget(budget) {
  if (!budget) return null
  return (budget.allocated || 0) - (budget.committed_amount || 0)
}

/** Called when a PR reaches 'approved' — commit its estimated_total against the budget */
export async function commitBudget(budgetId, amount) {
  if (!budgetId || !amount) return
  const budget = await getBudget(budgetId)
  if (!budget) return
  await supabase.from('budgets')
    .update({ committed_amount: (budget.committed_amount || 0) + Number(amount) })
    .eq('id', budgetId)
}

/** Called when an approved-but-not-yet-PO'd PR is cancelled — release its commitment */
export async function releaseBudget(budgetId, amount) {
  if (!budgetId || !amount) return
  const budget = await getBudget(budgetId)
  if (!budget) return
  const next = Math.max(0, (budget.committed_amount || 0) - Number(amount))
  await supabase.from('budgets').update({ committed_amount: next }).eq('id', budgetId)
}
