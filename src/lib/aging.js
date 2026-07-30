import { supabase } from './supabase'
import { getFinanceSettings } from './actualCost'

// Buckets open (unpaid, non-cancelled) invoices by days-past-due using
// finance_settings.aging_bucket_days (default [30,60,90]). Computed live on
// request — this app has no cron/scheduled job infrastructure, so "Overdue" is
// always derived at read time rather than a persisted, potentially-stale flag.
export async function getAgingBuckets(type) {
  const { agingBucketDays } = await getFinanceSettings()
  const today = new Date()

  let rows
  if (type === 'vendor') {
    const { data } = await supabase.from('invoices')
      .select('id,invoice_number,vendor_name,vendor:vendors(name),project:projects(name),due_date,total_amount,status')
      .not('status', 'in', '(paid,rejected)')
    rows = (data || []).map(r => ({ ...r, party: r.vendor?.name || r.vendor_name || '—' }))
  } else {
    const { data } = await supabase.from('customer_invoices')
      .select('id,invoice_number,customer:customers(name),project:projects(name),due_date,total_amount,status')
      .not('status', 'in', '(paid,cancelled)')
    rows = (data || []).map(r => ({ ...r, party: r.customer?.name || r.project?.name || '—' }))
  }

  const labels = []
  for (let i = 0; i < agingBucketDays.length; i++) {
    const lo = i === 0 ? 1 : agingBucketDays[i - 1] + 1
    labels.push(`${lo}-${agingBucketDays[i]}`)
  }
  labels.push(`${agingBucketDays[agingBucketDays.length - 1] + 1}+`)

  const buckets = { current: [], ...Object.fromEntries(labels.map(l => [l, []])) }
  for (const r of rows) {
    if (!r.due_date) { buckets.current.push(r); continue }
    const daysPastDue = Math.floor((today - new Date(r.due_date)) / 86400000)
    if (daysPastDue <= 0) { buckets.current.push(r); continue }
    let placed = false
    for (let i = 0; i < agingBucketDays.length; i++) {
      if (daysPastDue <= agingBucketDays[i]) { buckets[labels[i]].push(r); placed = true; break }
    }
    if (!placed) buckets[labels[labels.length - 1]].push(r)
  }

  return { buckets, labels: ['current', ...labels] }
}
