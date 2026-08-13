import { supabase } from './supabase'

// Cross-entity data search (Cmd/Ctrl+K) — distinct from Layout.jsx's
// existing sidebar search, which only filters the nav menu's own labels,
// never touches actual records. RLS does the real access control here:
// e.g. award_certificates' SELECT policy (STEP121) already restricts a
// plain employee to their own certificates, so this function doesn't
// special-case roles — an unprivileged caller's query to any table below
// just naturally returns fewer/zero rows, the same way every other page
// in this app relies on RLS rather than a client-side role check.
export async function globalSearch(query, orgId) {
  const q = query.trim()
  if (!q || q.length < 2 || !orgId) return []
  const like = `%${q}%`

  const [
    employees, departments, awards, cycles, certs,
    projects, tasks, customers, vendors, proposals, invoices, pos, scenarios,
  ] = await Promise.all([
    supabase.from('profiles').select('id,full_name,email,designation').eq('organization_id', orgId)
      .or(`full_name.ilike.${like},email.ilike.${like}`).limit(6),
    supabase.from('departments').select('id,name,code').eq('organization_id', orgId).ilike('name', like).limit(6),
    supabase.from('performance_awards').select('id,name,code,status').eq('organization_id', orgId).ilike('name', like).limit(6),
    supabase.from('performance_cycles').select('id,cycle_name,status').eq('organization_id', orgId).ilike('cycle_name', like).limit(6),
    supabase.from('award_certificates').select('id,certificate_number').eq('organization_id', orgId).ilike('certificate_number', like).limit(6),
    supabase.from('projects').select('id,name,code,status').eq('organization_id', orgId).ilike('name', like).limit(6),
    supabase.from('project_tasks').select('id,task_name,status').eq('organization_id', orgId).ilike('task_name', like).limit(6),
    supabase.from('customers').select('id,name,city').eq('organization_id', orgId).ilike('name', like).limit(6),
    supabase.from('vendors').select('id,name,category').eq('organization_id', orgId).ilike('name', like).limit(6),
    supabase.from('proposals').select('id,proposal_name,proposal_number,status').eq('organization_id', orgId).ilike('proposal_name', like).limit(6),
    supabase.from('customer_invoices').select('id,invoice_number,status').eq('organization_id', orgId).ilike('invoice_number', like).limit(6),
    supabase.from('purchase_orders').select('id,po_number,status').eq('organization_id', orgId).ilike('po_number', like).limit(6),
    supabase.from('scenarios').select('id,name,code,versions:scenario_versions(id,version_number)').eq('organization_id', orgId).is('deleted_at', null).ilike('name', like).limit(6),
  ])

  const results = []
  if (employees.data?.length) {
    results.push({ category: 'Employees', items: employees.data.map(e => ({ id: e.id, label: e.full_name || e.email, sublabel: e.designation || e.email, link: '/users' })) })
  }
  if (departments.data?.length) {
    results.push({ category: 'Departments', items: departments.data.map(d => ({ id: d.id, label: d.name, sublabel: d.code || 'Department', link: '/settings' })) })
  }
  if (projects.data?.length) {
    results.push({ category: 'Projects', items: projects.data.map(p => ({ id: p.id, label: p.name, sublabel: `${p.code || ''} · ${p.status}`.trim(), link: '/projects' })) })
  }
  if (tasks.data?.length) {
    results.push({ category: 'Tasks', items: tasks.data.map(t => ({ id: t.id, label: t.task_name, sublabel: t.status, link: '/tasks' })) })
  }
  if (customers.data?.length) {
    results.push({ category: 'Customers', items: customers.data.map(c => ({ id: c.id, label: c.name, sublabel: c.city || 'Customer', link: '/customers' })) })
  }
  if (vendors.data?.length) {
    results.push({ category: 'Vendors', items: vendors.data.map(v => ({ id: v.id, label: v.name, sublabel: v.category || 'Vendor', link: '/vendors' })) })
  }
  if (proposals.data?.length) {
    results.push({ category: 'Proposals', items: proposals.data.map(p => ({ id: p.id, label: p.proposal_name, sublabel: `${p.proposal_number} · ${p.status}`, link: '/proposals' })) })
  }
  if (invoices.data?.length) {
    results.push({ category: 'Customer Invoices', items: invoices.data.map(i => ({ id: i.id, label: i.invoice_number, sublabel: i.status, link: '/customer-invoices' })) })
  }
  if (pos.data?.length) {
    results.push({ category: 'Purchase Orders', items: pos.data.map(p => ({ id: p.id, label: p.po_number, sublabel: p.status, link: '/pos' })) })
  }
  if (scenarios.data?.length) {
    results.push({ category: 'Scenarios', items: scenarios.data.map(s => {
      const latest = (s.versions || []).slice().sort((a, b) => b.version_number - a.version_number)[0]
      return { id: s.id, label: s.name, sublabel: s.code || 'Scenario', link: latest ? `/scenarios/${latest.id}` : '/scenarios' }
    }) })
  }
  if (awards.data?.length) {
    results.push({ category: 'Awards', items: awards.data.map(a => ({ id: a.id, label: a.name, sublabel: `${a.code} · ${a.status}`, link: `/awards/${a.id}/edit` })) })
  }
  if (cycles.data?.length) {
    results.push({ category: 'Performance Cycles', items: cycles.data.map(c => ({ id: c.id, label: c.cycle_name, sublabel: c.status, link: '/performance-cycles' })) })
  }
  if (certs.data?.length) {
    results.push({ category: 'Certificates', items: certs.data.map(c => ({ id: c.id, label: c.certificate_number, sublabel: 'Certificate', link: '/my-awards' })) })
  }
  return results
}
