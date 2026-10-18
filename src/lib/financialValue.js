/**
 * FinancialValue — the universal source-tagging object every monetary field
 * in the ROI Enterprise Economics layer carries, instead of a bare number.
 * Stored as JSONB: { amount, currency, source, source_ref, updated_at, status }.
 *
 * source: 'existing_project' (pulled from Project/Budget Line/Asset records —
 *   never hand-edited, refresh only) | 'manual' (user-entered — requires a
 *   reason/owner/date at the call site, which is why every manual write also
 *   creates a roi_manual_adjustment row, see roiEconomics.js) | 'calculated'
 *   (output of a calculation engine — never hand-edited).
 */
export const FV_SOURCE = { EXISTING: 'existing_project', MANUAL: 'manual', CALCULATED: 'calculated' }
export const FV_STATUS = { ACTUAL: 'actual', PENDING: 'pending_approval', APPROVED: 'approved' }

export function fv(amount, { currency = 'INR', source = FV_SOURCE.MANUAL, sourceRef = null, status = FV_STATUS.ACTUAL } = {}) {
  return {
    amount: Math.round((Number(amount) || 0) * 100) / 100,
    currency, source, source_ref: sourceRef,
    updated_at: new Date().toISOString(), status,
  }
}

export function fvAmount(value) { return Number(value?.amount) || 0 }

export const FV_SOURCE_LABEL = {
  existing_project: 'Existing Project Data',
  manual: 'Manual',
  calculated: 'Calculated',
}
export function fvSourceLabel(value) { return FV_SOURCE_LABEL[value?.source] || 'Unset' }

export const FV_SOURCE_COLOR = {
  existing_project: '#0ea5e9',
  manual: '#f59e0b',
  calculated: '#6366f1',
}
export function fvSourceColor(value) { return FV_SOURCE_COLOR[value?.source] || '#94a3b8' }
