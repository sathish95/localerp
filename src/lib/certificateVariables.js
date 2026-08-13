// Certificate dynamic-variable registry (spec §16/§33) — a flat list of
// {key, label} grouped for the builder's variable picker. Adding a new
// variable later (spec §17's "custom fields" requirement) means adding
// one entry here plus one line in the resolver that produces it — no
// schema change, since text elements just store a `content` string with
// `{{key}}` tokens and images store a `variableKey` string.
export const CERTIFICATE_VARIABLE_GROUPS = [
  { group: 'Employee', vars: [
    { key: 'employee_name', label: 'Employee Name' },
    { key: 'employee_code', label: 'Employee ID' },
    { key: 'designation', label: 'Designation' },
    { key: 'department', label: 'Department' },
  ]},
  { group: 'Award', vars: [
    { key: 'award_name', label: 'Award Name' },
    { key: 'award_category', label: 'Award Category' },
    { key: 'award_description', label: 'Award Description' },
    { key: 'award_period', label: 'Award Period' },
    { key: 'award_date', label: 'Award Date' },
    { key: 'award_year', label: 'Award Year' },
    { key: 'final_score', label: 'Final Score' },
    { key: 'rank', label: 'Rank' },
  ]},
  { group: 'Manager', vars: [
    { key: 'manager_name', label: 'Manager Name' },
  ]},
  { group: 'HR', vars: [
    { key: 'hr_name', label: 'HR Name' },
  ]},
  { group: 'Company', vars: [
    { key: 'company_name', label: 'Company Name' },
  ]},
  { group: 'Certificate', vars: [
    { key: 'certificate_number', label: 'Certificate Number' },
    { key: 'issue_date', label: 'Issue Date' },
  ]},
]

export const ALL_TEXT_VARIABLES = CERTIFICATE_VARIABLE_GROUPS.flatMap(g => g.vars)

// company_logo/signature/qr_code are image-producing, not text — they're
// separate element types (image with variableKey='company_logo', and the
// dedicated 'qrcode' element type) rather than {{tokens}} inside text.
export const IMAGE_VARIABLES = [
  { key: 'company_logo', label: 'Company Logo' },
]

export function resolveTemplateString(str, data) {
  return String(str ?? '').replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const v = data[key]
    return v == null || v === '' ? '' : String(v)
  })
}

export function rankLabel(rank) {
  if (!rank) return ''
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th'
    : rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th'
  return `#${rank} (${rank}${suffix})`
}

export const SAMPLE_CERTIFICATE_DATA = {
  employee_name: 'Jordan Employee', employee_code: 'EMP-1042', designation: 'Senior Engineer', department: 'Engineering',
  award_name: 'Outstanding Performer', award_category: 'Best Performer', award_description: 'Recognizing exceptional contribution',
  award_period: 'Q3 2026', award_date: '15 Aug 2026', award_year: '2026', final_score: '94.5', rank: '#1',
  manager_name: 'Alex Manager', hr_name: 'Sam HR', company_name: 'Your Company',
  certificate_number: 'CERT-2026-000001', issue_date: '15 Aug 2026',
}
