// Starting lifecycle templates for the project Document Compliance Register
// (STEP272). Loaded on demand into editable rows (ei_lifecycle_templates /
// _stages / _requirements); every project copies the template's requirements
// into its own register, where they can be changed, waived or marked not
// applicable. Requirements point at document type codes of the baseline
// taxonomy (eiTaxonomyData.js) — load the taxonomy first so they can match.
//
// Requirement entry: 'CODE' | 'CODE|flags' with flags: a = needs approval,
// s = statutory, e = tracks expiry, o = optional (not required).
// Government procedures differ by department, authority, country and contract:
// these are templates to copy and adjust, never a fixed procedure.

export const LIFECYCLE_TEMPLATES = [
  {
    key: 'GOVERNMENT_PUBLIC_WORKS', name: 'Government / public-sector project', sector: 'government',
    description: 'Tender to closure for a public-sector contract. Adjust stages and documents to the authority, department and contract.',
    stages: [
      ['Tender publication and procurement', ['NOTICE_INVITING_TENDER', 'BID_PACKAGE|o', 'CORRIGENDUM|o', 'ADDENDUM|o', 'PRE_BID_MEETING_MINUTES|o']],
      ['Eligibility and prequalification', ['PREQUALIFICATION_DOCUMENT|o', 'REGISTRATION_CERTIFICATE|s', 'EARNEST_MONEY_DEPOSIT|e', 'TENDER_FEE_RECEIPT|o']],
      ['Bid submission, opening and evaluation', ['TECHNICAL_BID', 'FINANCIAL_BID', 'BID_SUBMISSION_RECEIPT', 'BID_OPENING_RECORD|o', 'BID_EVALUATION_REPORT|o']],
      ['Award, contract signing and security', ['LETTER_OF_ACCEPTANCE|a', 'GOVERNMENT_CONTRACT_AGREEMENT|a', 'PERFORMANCE_BANK_GUARANTEE|e', 'INSURANCE_POLICY|e']],
      ['Administrative, financial and technical sanctions', ['ADMINISTRATIVE_APPROVAL|a', 'EXPENDITURE_SANCTION|a', 'TECHNICAL_SANCTION|a']],
      ['Mobilization and commencement', ['NOTICE_TO_PROCEED|a', 'COMMENCEMENT_ORDER|a', 'SITE_HANDOVER_MEMO', 'MOBILIZATION_PLAN', 'ADVANCE_PAYMENT_GUARANTEE|e o']],
      ['Design and engineering approvals', ['DESIGN_APPROVAL|a', 'ISSUED_FOR_CONSTRUCTION_DRAWING|a', 'QUALITY_ASSURANCE_PLAN|a']],
      ['Procurement and vendor approvals', ['APPROVED_VENDOR_LIST|a', 'MATERIAL_APPROVAL_REQUEST|a o']],
      ['Land, utility, statutory and environmental permissions', ['NO_OBJECTION_CERTIFICATE|s a e', 'ENVIRONMENTAL_CLEARANCE|s a e o', 'RIGHT_OF_WAY_APPROVAL|s a o', 'UTILITY_SHIFTING_APPROVAL|s a o', 'BUILDING_PERMIT|s a e o']],
      ['Execution, inspection, quality and progress', ['INSPECTION_AND_TEST_PLAN|a', 'WORK_INSPECTION_REQUEST|o', 'MATERIAL_INSPECTION_REQUEST|o', 'MONTHLY_PROGRESS_REPORT', 'PROGRESS_REVIEW_MINUTES|o']],
      ['Measurement, billing, payment and deductions', ['MEASUREMENT_BOOK', 'RUNNING_ACCOUNT_BILL', 'BILL_PASSING_MEMO|o', 'INTERIM_PAYMENT_CERTIFICATE|o']],
      ['Variations, EOT, delays, claims and disputes', ['VARIATION_SANCTION|a o', 'EOT_DECISION|a o', 'DELAY_NOTICE|o']],
      ['Safety, statutory inspections, audits and vigilance', ['HSE_PLAN|a', 'STATUTORY_INSPECTION_CERTIFICATE|s e o', 'AUDIT_REPLY|o']],
      ['Testing, commissioning and performance verification', ['COMMISSIONING_CHECKLIST', 'PERFORMANCE_TEST_REPORT|a', 'COMMISSIONING_APPROVAL|a']],
      ['Completion, handover and asset transfer', ['COMPLETION_CERTIFICATE|a', 'TAKING_OVER_CERTIFICATE|a', 'ASSET_TRANSFER|o', 'O_AND_M_MANUAL']],
      ['Defects liability, warranty, final settlement and closure', ['DEFECTS_LIABILITY_NOTICE|o', 'FINAL_BILL', 'UTILIZATION_CERTIFICATE|o', 'PROJECT_CLOSURE_ORDER|a']],
    ],
  },
  {
    key: 'EPC_PROJECT', name: 'EPC / construction project', sector: 'construction',
    description: 'Contract to handover for an EPC or construction contract.',
    stages: [
      ['Contract and securities', ['CONTRACT_AGREEMENT|a', 'PERFORMANCE_BANK_GUARANTEE|e', 'ADVANCE_PAYMENT_GUARANTEE|e o', 'INSURANCE_POLICY|e']],
      ['Engineering', ['DESIGN_BASIS_REPORT|a', 'ISSUED_FOR_CONSTRUCTION_DRAWING|a', 'ENGINEERING_DELIVERABLES_REGISTER']],
      ['Planning and mobilization', ['PROJECT_SCHEDULE|a', 'MOBILIZATION_PLAN', 'METHOD_STATEMENT|a', 'QUALITY_ASSURANCE_PLAN|a', 'HSE_PLAN|a']],
      ['Procurement', ['PROCUREMENT_SCHEDULE', 'APPROVED_VENDOR_LIST|a o']],
      ['Construction and quality', ['INSPECTION_AND_TEST_PLAN|a', 'MONTHLY_PROGRESS_REPORT', 'NON_CONFORMANCE_REPORT|o']],
      ['Billing', ['RUNNING_ACCOUNT_BILL', 'JOINT_MEASUREMENT_SHEET|o']],
      ['Commissioning and handover', ['COMMISSIONING_CHECKLIST', 'MECHANICAL_COMPLETION_CERTIFICATE|a', 'TAKING_OVER_CERTIFICATE|a', 'O_AND_M_MANUAL', 'AS_BUILT_DRAWING']],
      ['Close-out', ['FINAL_ACCEPTANCE_CERTIFICATE|a', 'FINAL_BILL', 'LESSONS_LEARNED|o']],
    ],
  },
  {
    key: 'IT_DELIVERY', name: 'IT / software delivery project', sector: 'it',
    description: 'Contract to go-live and support handover for an IT project.',
    stages: [
      ['Contract', ['STATEMENT_OF_WORK|a', 'SERVICE_LEVEL_AGREEMENT|a o', 'NON_DISCLOSURE_AGREEMENT|o']],
      ['Requirements and design', ['BUSINESS_REQUIREMENTS_DOCUMENT|a', 'SOFTWARE_REQUIREMENTS_SPECIFICATION|a o', 'HIGH_LEVEL_DESIGN|a']],
      ['Testing', ['TEST_PLAN', 'SYSTEM_INTEGRATION_TEST_REPORT', 'USER_ACCEPTANCE_TEST_REPORT|a']],
      ['Release', ['DEPLOYMENT_PLAN', 'ROLLBACK_PLAN|o', 'RELEASE_NOTES']],
      ['Handover', ['RUNBOOK', 'SUPPORT_HANDOVER_DOCUMENT', 'PROJECT_CLOSURE_REPORT|a']],
    ],
  },
]

// Document types whose expiry matters (guarantees, policies, permits,
// certificates): the baseline gives them extraction fields so the number,
// amount and expiry date are read from the document.
export const EXPIRY_CODES = [
  'BANK_GUARANTEE', 'PERFORMANCE_BANK_GUARANTEE', 'ADVANCE_PAYMENT_GUARANTEE', 'RETENTION_GUARANTEE', 'CORPORATE_GUARANTEE', 'SURETY_BOND',
  'BID_BOND', 'PERFORMANCE_BOND', 'LETTER_OF_CREDIT', 'EARNEST_MONEY_DEPOSIT', 'INSURANCE_POLICY', 'CERTIFICATE_OF_INSURANCE', 'VEHICLE_INSURANCE',
  'NO_OBJECTION_CERTIFICATE', 'ENVIRONMENTAL_CLEARANCE', 'BUILDING_PERMIT', 'STATUTORY_PERMIT', 'STATUTORY_INSPECTION_CERTIFICATE',
  'FITNESS_CERTIFICATE', 'PUC_CERTIFICATE', 'TRANSPORT_PERMIT', 'DRIVER_LICENCE', 'CALIBRATION_CERTIFICATE', 'REGISTRATION_CERTIFICATE',
  'LICENCE_RENEWAL', 'PERMIT_TO_WORK', 'GRID_CONNECTIVITY_APPROVAL', 'WARRANTY_CERTIFICATE', 'TAX_CERTIFICATE',
]
export const EXPIRY_FIELDS = [
  { key: 'document_number', label: 'Number', type: 'text' },
  { key: 'amount', label: 'Amount', type: 'money' },
  { key: 'issue_date', label: 'Issue date', type: 'date' },
  { key: 'expiry_date', label: 'Expiry / valid until', type: 'date' },
  { key: 'issuer', label: 'Issued by', type: 'text' },
]

export function parseRequirement(entry) {
  const [code, flags = ''] = String(entry).split('|')
  const f = flags.split(/\s+/)
  return { document_type_code: code.trim(), required: !f.includes('o'), needs_approval: f.includes('a'), is_statutory: f.includes('s'), tracks_expiry: f.includes('e') }
}
