import { supabase, dateFmt } from './supabase'
import { sendNotif } from './notifications'
import { getDocumentSettings } from './documentSettings'
import { getLatestVersion } from './certificateTemplates'
import { renderCertificatePdf } from './certificatePdf'

async function findTemplateForCategory(categoryId) {
  let q = supabase.from('award_certificate_templates').select('*').eq('status', 'active')
  const { data, error } = await q
  if (error) throw error
  const rows = data || []
  return rows.find(t => t.award_category_id === categoryId) || rows.find(t => !t.award_category_id) || null
}

async function nextCertificateNumber() {
  const year = new Date().getFullYear()
  const prefix = `CERT-${year}-`
  const { count, error } = await supabase.from('award_certificates').select('id', { count: 'exact', head: true }).like('certificate_number', `${prefix}%`)
  if (error) throw error
  return `${prefix}${String((count || 0) + 1).padStart(6, '0')}`
}

// Best-effort — called from decideAward() on grant. Returns null (never
// throws into the caller) when there's no active template to generate
// from yet, so a manager can still grant an award before HR has set up
// a certificate design; the notification/HR nudge to add one is a
// follow-up, not a blocker on granting.
export async function generateCertificate(awardId, employeeId, managerId) {
  const existing = await getCertificateForAward(awardId, employeeId)
  if (existing) return existing

  const [{ data: award, error: awardErr }, { data: employee, error: empErr }, { data: participant }, { data: manager }, settings] = await Promise.all([
    supabase.from('performance_awards').select('*, category:award_categories(id,name)').eq('id', awardId).single(),
    supabase.from('profiles').select('full_name, employee_id, designation, dept:departments(name)').eq('id', employeeId).single(),
    supabase.from('award_participants').select('final_score, rank').eq('award_id', awardId).eq('employee_id', employeeId).single(),
    supabase.from('profiles').select('full_name').eq('id', managerId).maybeSingle(),
    getDocumentSettings(),
  ])
  if (awardErr) throw awardErr
  if (empErr) throw empErr

  const template = await findTemplateForCategory(award.category?.id)
  if (!template) return null
  const version = await getLatestVersion(template.id)
  if (!version) return null

  const { data: hr } = award.created_by ? await supabase.from('profiles').select('full_name').eq('id', award.created_by).maybeSingle() : { data: null }
  const certificateNumber = await nextCertificateNumber()
  const today = new Date().toISOString().slice(0, 10)

  const resolvedData = {
    employee_name: employee.full_name || '', employee_code: employee.employee_id || '',
    designation: employee.designation || '', department: employee.dept?.name || '',
    award_name: award.name, award_category: award.category?.name || '', award_description: award.description || '',
    award_period: award.start_date ? `${dateFmt(award.start_date)} - ${dateFmt(award.end_date)}` : '',
    award_date: dateFmt(today), award_year: String(new Date().getFullYear()),
    final_score: participant?.final_score != null ? String(participant.final_score) : '',
    rank: participant?.rank ? `#${participant.rank}` : '',
    manager_name: manager?.full_name || '', hr_name: hr?.full_name || '',
    company_name: settings?.business_name || '', company_logo: settings?.header_logo || '',
    certificate_number: certificateNumber, issue_date: dateFmt(today),
  }

  const { data: certificate, error } = await supabase.from('award_certificates').insert({
    award_id: awardId, employee_id: employeeId, template_version_id: version.id,
    certificate_number: certificateNumber, resolved_data: resolvedData, generated_by: managerId,
  }).select().single()
  if (error) throw error

  await sendNotif(employeeId, {
    type: 'certificate_ready', title: 'Your certificate is ready',
    body: `Your certificate for "${award.name}" (${certificateNumber}) is ready to download.`,
    link: '/my-awards', senderId: managerId,
  })

  return certificate
}

export async function getMyCertificates(employeeId) {
  const { data, error } = await supabase.from('award_certificates')
    .select('*, award:performance_awards(name)').eq('employee_id', employeeId).order('generated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getCertificateForAward(awardId, employeeId) {
  const { data, error } = await supabase.from('award_certificates')
    .select('*, award:performance_awards(name)').eq('award_id', awardId).eq('employee_id', employeeId).maybeSingle()
  if (error) throw error
  return data || null
}

export function verifyUrlFor(certificateNumber) {
  return `${window.location.origin}/verify/${certificateNumber}`
}

export async function downloadCertificatePdf(certificate) {
  const { data: version, error } = await supabase.from('award_certificate_template_versions').select('*').eq('id', certificate.template_version_id).single()
  if (error) throw error
  const doc = await renderCertificatePdf(version, certificate.resolved_data, verifyUrlFor(certificate.certificate_number))
  doc.save(`${certificate.certificate_number}.pdf`)
}
