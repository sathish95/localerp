// Baseline corporate document taxonomy (Email Intelligence, STEP269).
// A starting point, not a limit: it is loaded into the org's EDITABLE document
// types / acronym registry (Configuration → Document types → "Load baseline
// taxonomy"), where admins rename, merge, deactivate or extend it, and where
// the AI's new-type suggestions (STEP270) land after approval.
//
// Type entry format:  'Name'  |  'Name|ALIAS;Alias two'  |  'Name|aliases|AREA'
//   ALL-CAPS aliases of ≤ 8 chars are acronyms: they also go into the acronym
//   registry, where they only count when the document's context agrees
//   (never routed on the acronym alone when it has several meanings).
// Family defaults: area (project workspace), primary module (src/config/modules.js
// key), related modules, industries.

export const FAMILIES = [
  { key: 'CORPORATE_COMMUNICATION', name: 'Corporate Communication', area: 'CORRESPONDENCE', module: 'projects', related: [], industries: ['all'], types: [
    'Business correspondence|Business letter', 'Official letter', 'Cover letter', 'Transmittal|Document transmittal', 'Forwarding letter', 'Memo|Memorandum',
    'Circular', 'Notice', 'Notification', 'Acknowledgement|Acknowledgment', 'Confirmation letter', 'Declaration', 'Undertaking', 'Request letter',
    'Response letter|Reply letter', 'Follow-up letter|Reminder letter', 'Escalation letter', 'Show-cause notice|SCN', 'Dispute correspondence',
    'Claim letter', 'Demand notice|Demand letter', 'Decision letter', 'Action tracker|Action item list', 'Meeting minutes|MoM;MOM;Minutes of meeting',
  ] },
  { key: 'SALES_CRM', name: 'Sales, CRM and Client Management', area: 'CORRESPONDENCE', module: 'sales-opportunities', related: ['customers'], industries: ['all'], types: [
    'Customer enquiry|Customer inquiry', 'Request for information|RFI', 'Request for proposal|RFP', 'Request for quotation|RFQ', 'Proposal|Techno-commercial proposal',
    'Quotation|Quote', 'Estimate|Cost estimate', 'Pricing sheet|Price list', 'Rate card', 'Product catalogue|Product catalog', 'Service catalogue|Service catalog',
    'Capability statement', 'Company profile|Corporate profile', 'Customer onboarding form', 'Customer KYC|Client KYC', 'Sales order|SO',
    'Order confirmation', 'Customer purchase order|Client PO', 'Change request|CR', 'Service request|SR', 'Customer complaint', 'Renewal notice',
    'Acceptance record|Customer acceptance', 'Customer satisfaction report|CSAT report',
  ] },
  { key: 'TENDERING', name: 'Tendering and Bids', area: 'TENDER_CONTRACT', module: 'sales-tenders', related: ['proposals'], industries: ['all', 'government'], types: [
    'Notice inviting tender|NIT', 'Tender notice', 'Expression of interest|EOI', 'Prequalification document|PQ;Pre-qualification', 'Bid invitation',
    'Invitation to tender|ITT', 'Bid package|Tender document', 'Technical bid', 'Commercial bid', 'Financial bid|Price bid', 'Bid security',
    'Earnest money deposit|EMD', 'Tender fee receipt', 'Pre-bid query', 'Pre-bid meeting minutes|Pre-bid minutes', 'Clarification request',
    'Corrigendum', 'Addendum|Tender addendum', 'Revised tender', 'Bid submission receipt', 'Bid opening record|Bid opening notice',
    'Bid evaluation report|Bid evaluation', 'Comparative statement|CS', 'Negotiation notice', 'Award recommendation',
    'Letter of acceptance|LOA', 'Letter of intent|LOI', 'Notice of award|NOA',
  ] },
  { key: 'CONTRACTS_LEGAL', name: 'Contracts and Legal', area: 'TENDER_CONTRACT', module: 'projects', related: ['customers', 'vendors'], industries: ['all'], types: [
    'Non-disclosure agreement|NDA', 'Memorandum of understanding|MOU;MoU', 'Memorandum of agreement|MOA', 'Master services agreement|MSA',
    'Statement of work|SOW', 'Service level agreement|SLA', 'Contract agreement|Contract', 'Service agreement', 'Supply agreement',
    'EPC agreement|EPC contract', 'Subcontract|Subcontract agreement', 'Framework agreement', 'Lease agreement|Lease', 'Licence agreement|License agreement',
    'Contract amendment|Amendment', 'Contract addendum', 'Contract renewal', 'Contract extension', 'Novation agreement', 'Termination notice',
    'Suspension notice', 'Indemnity', 'Guarantee deed', 'Waiver', 'Power of attorney|POA', 'Board resolution', 'Legal opinion', 'Legal claim',
    'Arbitration notice', 'Settlement agreement', 'Contract obligation register',
  ] },
  { key: 'PROJECT_CONTROLS', name: 'Project Management and Controls', area: 'PM_REPORTING', module: 'projects', related: ['tasks'], industries: ['all'], types: [
    'Project charter', 'Business case', 'Project execution plan|PEP', 'Project management plan|PMP', 'Work breakdown structure|WBS',
    'Project schedule|Programme;Master schedule', 'Baseline schedule', 'Milestone plan', 'Resource plan', 'Look-ahead plan|Three week look ahead',
    'Daily progress report|DPR', 'Weekly progress report|WPR', 'Monthly progress report|MPR', 'KPI report', 'S-curve|S curve',
    'Risk register', 'Issue log', 'RAID log', 'Dependency register', 'Decision log', 'Delay analysis', 'Extension of time request|EOT;EoT',
    'Recovery plan', 'Acceleration plan', 'Steering committee pack', 'Handover plan', 'Project closure report|Closure report', 'Lessons learned',
  ] },
  { key: 'ENGINEERING', name: 'Engineering and Technical', area: 'ENGINEERING', module: 'projects', related: [], industries: ['all'], types: [
    'Business requirements document|BRD;BRS', 'Functional requirements document|FRD;FRS', 'Software requirements specification|SRS',
    'Product requirements document|PRD', 'High-level design|HLD', 'Low-level design|LLD', 'Architecture document', 'Design basis',
    'Design calculations|Calculation report', 'Technical specification', 'Interface specification', 'Interface control document|ICD',
    'API specification', 'Data dictionary', 'Equipment datasheet|Datasheet', 'Bill of materials|BOM', 'CAD drawing|Drawing', 'BIM model',
    'Schematic', 'Technical submittal|Submittal', 'Engineering transmittal', 'Design review comments|Comment resolution sheet', 'Deviation request',
    'Engineering change request|ECR', 'Engineering change notice|ECN', 'As-built drawing|As built',
  ] },
  { key: 'EPC_CONSTRUCTION', name: 'EPC and Construction', area: 'SITE', module: 'projects', related: [], industries: ['construction', 'epc', 'infrastructure', 'government'], types: [
    'EPC tender package', "Employer's requirements|ER", 'FEED package|FEED', 'Design basis report|DBR', 'P&ID|P&ID;Piping and instrumentation diagram',
    'Issued for construction drawing|IFC|ENGINEERING', 'Vendor drawing||ENGINEERING', 'Engineering deliverables register|EDR|ENGINEERING',
    'Procurement schedule||PROCUREMENT', 'Construction execution plan', 'Mobilization plan', 'Method statement|MS', 'Inspection and test plan|ITP|QUALITY',
    'Quality assurance plan|QAP|QUALITY', 'Bill of quantities|BOQ;BoQ', 'Bar bending schedule|BBS', 'Technical query|TQ',
    'Material inspection request|MIR|QUALITY', 'Work inspection request|WIR|QUALITY', 'Material approval request|MAR|QUALITY', 'Inspection request|IR|QUALITY',
    'Concrete pour record|Pour card', 'Cube test report|QUALITY', 'Welding log', 'NDT report|NDT|QUALITY', 'Survey report', 'Site diary|Site daily log',
    'Site instruction|SI', 'Hindrance register', 'Measurement book|MB', 'Joint measurement sheet|JMS', 'Running account bill|RA bill;RA Bill|FINANCE',
    'Variation order|VO', 'Change order|CO', 'Extra item approval', 'Non-conformance report|NCR|QUALITY', 'Corrective action request|CAR|QUALITY',
    'Snag list', 'Punch list', 'Commissioning checklist|HANDOVER', 'Mechanical completion certificate|MCC|HANDOVER', 'Performance test report|PG test|HANDOVER',
    'Taking-over certificate|TOC|HANDOVER', 'Final acceptance certificate|FAC|HANDOVER', 'O&M manual|O&M;Operation and maintenance manual|HANDOVER',
    'Handover dossier|HANDOVER',
  ] },
  { key: 'PROCUREMENT', name: 'Procurement and Vendor Management', area: 'PROCUREMENT', module: 'procurement', related: ['vendors'], industries: ['all'], types: [
    'Purchase requisition|PR', 'Vendor enquiry|Vendor inquiry', 'Supplier quotation|Vendor quotation', 'Technical bid evaluation|TBE',
    'Commercial bid evaluation|CBE', 'Purchase order|PO', 'PO amendment|Purchase order amendment', 'Blanket purchase order|Blanket PO', 'Call-off order',
    'Work order|WO', 'Service order', 'Vendor onboarding form', 'Vendor registration', 'Vendor KYC|Supplier KYC', 'Supplier qualification',
    'Approved vendor list|AVL', 'Delivery schedule', 'Expediting report', 'Material requisition|MR', 'Goods receipt note|GRN|LOGISTICS',
    'Material return note|MRN|LOGISTICS', 'Vendor audit report', 'Supplier scorecard', 'Supplier corrective action request|SCAR', 'Supplier performance report',
  ] },
  { key: 'LOGISTICS', name: 'Logistics, Transport and Fleet', area: 'LOGISTICS', module: 'delivery-notes', related: ['grn'], industries: ['logistics', 'transport', 'all'], types: [
    'Delivery challan|DC', 'Delivery note', 'Packing list', 'Bill of lading|B/L;BL', 'Air waybill|AWB', 'Consignment note', 'Lorry receipt|LR',
    'Proof of delivery|POD', 'E-way bill|EWB', 'Shipping bill', 'Bill of entry|BOE', 'Customs declaration', 'Certificate of origin|COO',
    'Freight quotation', 'Freight contract', 'Trip sheet', 'Trip log', 'Manifest', 'Dispatch note', 'Transport invoice|FINANCE',
    'Vehicle registration certificate|RC', 'Vehicle insurance', 'Fitness certificate', 'Driver licence|Driving license', 'Transport permit',
    'PUC certificate|PUC', 'Fuel statement', 'Toll statement', 'Route plan', 'Fleet maintenance log', 'Accident report', 'Shipment tracking report',
    'Delivery exception report',
  ] },
  { key: 'FINANCE', name: 'Finance and Accounting', area: 'FINANCE', module: 'invoices', related: ['payments'], industries: ['all'], types: [
    'Tax invoice', 'Commercial invoice', 'Proforma invoice|PI', 'Purchase invoice', 'Sales invoice', 'Credit note|CN', 'Debit note|DN',
    'Statement of account|SOA', 'Payment request', 'Payment advice', 'Remittance advice', 'Payment certificate', 'Interim payment certificate|IPC',
    'Interim payment application|IPA', 'Final bill', 'Advance payment request', 'Retention statement', 'Retention release request', 'Expense claim',
    'Reimbursement claim', 'Journal voucher|JV', 'Debit voucher', 'Credit voucher', 'Bank statement', 'Bank reconciliation|BRS', 'Trial balance|TB',
    'Balance sheet', 'Profit and loss statement|P&L', 'Cash flow statement', 'Budget', 'Forecast', 'Cost sheet', 'Cost-to-complete report|CTC',
    'Accounts payable ageing|AP ageing', 'Accounts receivable ageing|AR ageing', 'Tax return', 'GST return|GSTR', 'TDS certificate|Form 16A',
    'Audit confirmation|Balance confirmation', 'Financial statements',
  ] },
  { key: 'BANKING_INSURANCE', name: 'Banking, Guarantees and Insurance', area: 'FINANCE', module: 'payments', related: ['projects'], industries: ['all'], types: [
    'Letter of credit|LC;L/C', 'Bank guarantee|BG', 'Performance bank guarantee|PBG', 'Advance payment guarantee|APG;ABG', 'Retention guarantee',
    'Corporate guarantee', 'Surety bond', 'Bid bond', 'Performance bond', 'Security deposit receipt', 'Bank mandate', 'Credit application',
    'Credit approval', 'UTR confirmation|UTR', 'Remittance confirmation', 'Insurance policy', 'Certificate of insurance|COI|SAFETY_COMPLIANCE',
    'Insurance endorsement', 'Insurance claim', 'Claim settlement letter',
  ] },
  { key: 'HR_WORKFORCE', name: 'HR and Workforce', area: 'OTHER', module: 'users', related: [], industries: ['all'], types: [
    'CV|Resume;Curriculum vitae', 'Employee onboarding form', 'Offer letter', 'Appointment letter', 'Employment contract', 'Joining report',
    'Employee KYC', 'Timesheet', 'Attendance sheet', 'Overtime sheet', 'Leave request|Leave application', 'Payroll input', 'Payslip|Salary slip',
    'Travel authorization', 'Performance review|Appraisal', 'Training record', 'Competency matrix', 'Skill matrix', 'Resource allocation sheet',
    'Mobilization request|Manpower mobilization', 'Demobilization request', 'Experience certificate', 'Relieving letter', 'Exit checklist',
  ] },
  { key: 'IT_DIGITAL', name: 'IT and Digital Services', area: 'OPERATIONS', module: 'projects', related: ['tasks'], industries: ['it'], types: [
    'User stories', 'Acceptance criteria', 'Use cases', 'Architecture diagram', 'Database schema', 'Migration plan', 'Test plan', 'Test cases',
    'System integration test report|SIT', 'User acceptance test report|UAT;UAT sign-off', 'Regression test report', 'Performance test report',
    'Security assessment', 'Vulnerability assessment report|VAPT', 'Request for change|RFC', 'Release notes', 'Deployment plan', 'Rollback plan',
    'Runbook', 'Standard operating procedure|SOP', 'Incident report', 'Problem record', 'Root cause analysis|RCA', 'Postmortem|Post-incident review',
    'SLA report', 'Backup report', 'Disaster recovery plan|DRP;DR plan', 'Business continuity plan|BCP', 'Licence record|License record',
    'Support handover document',
  ] },
  { key: 'ENERGY_UTILITIES', name: 'Energy and Utilities', area: 'OPERATIONS', module: 'assets', related: ['projects'], industries: ['energy', 'utilities'], types: [
    'Power purchase agreement|PPA|TENDER_CONTRACT', 'Energy supply agreement|TENDER_CONTRACT', 'Single-line diagram|SLD|ENGINEERING', 'Load study|ENGINEERING',
    'Energy audit', 'Consumption statement', 'Meter reading', 'Commissioning report|HANDOVER', 'Calibration certificate|QUALITY', 'Transformer test report|QUALITY',
    'Relay test report|QUALITY', 'Outage request|Shutdown request', 'Switching plan', 'Grid connectivity approval|SAFETY_COMPLIANCE', 'Maintenance plan',
    'Breakdown report', 'Equipment history', 'Permit to work|PTW|SAFETY_COMPLIANCE', 'Production report|Generation report', 'Energy settlement statement|FINANCE',
    'Regulatory filing|SAFETY_COMPLIANCE',
  ] },
  { key: 'MANUFACTURING', name: 'Manufacturing and Industrial Operations', area: 'QUALITY', module: 'products', related: ['inventory'], industries: ['manufacturing'], types: [
    'Production order', 'Manufacturing work order', 'Batch record', 'Job card', 'Material certificate', 'Mill test certificate|MTC',
    'Certificate of conformity|COC;CoC', 'Certificate of analysis|COA;CoA', 'Inspection report', 'First article inspection|FAI', 'PPAP|PPAP',
    'APQP|APQP', 'Control plan', 'SPC report', 'Calibration log', 'Equipment validation', 'Factory acceptance test|FAT', 'Site acceptance test|SAT',
    'CAPA|CAPA', '8D report|8D', 'Traceability record', 'Batch release certificate', 'Warranty claim|OPERATIONS', 'Product recall notice',
  ] },
  { key: 'QHSE', name: 'Quality, Safety and Environment', area: 'QUALITY', module: 'projects', related: [], industries: ['all'], types: [
    'QMS manual|Quality manual', 'Quality policy', 'Quality plan', 'Inspection checklist', 'Audit report', 'HIRA|HIRA|SAFETY_COMPLIANCE',
    'Job safety analysis|JSA|SAFETY_COMPLIANCE', 'Job hazard analysis|JHA|SAFETY_COMPLIANCE', 'Risk assessment|SAFETY_COMPLIANCE', 'HSE plan|SAFETY_COMPLIANCE',
    'Hot-work permit|SAFETY_COMPLIANCE', 'Confined-space permit|SAFETY_COMPLIANCE', 'Lifting plan|SAFETY_COMPLIANCE', 'Toolbox talk|TBT|SAFETY_COMPLIANCE',
    'Safety induction record|SAFETY_COMPLIANCE', 'Near-miss report|SAFETY_COMPLIANCE', 'Accident investigation report|SAFETY_COMPLIANCE',
    'Environmental impact assessment|EIA|SAFETY_COMPLIANCE', 'Waste manifest|SAFETY_COMPLIANCE', 'Emissions report|SAFETY_COMPLIANCE',
    'Safety data sheet|SDS;MSDS|SAFETY_COMPLIANCE', 'Emergency response plan|ERP|SAFETY_COMPLIANCE', 'Statutory inspection certificate|SAFETY_COMPLIANCE',
  ] },
  { key: 'COMPLIANCE_GOVERNANCE', name: 'Compliance and Corporate Governance', area: 'SAFETY_COMPLIANCE', module: null, related: [], industries: ['all'], types: [
    'Certificate of incorporation', 'Registration certificate', 'Statutory register', 'Shareholder resolution', 'Director declaration',
    'Beneficial ownership declaration', 'Compliance checklist', 'Internal audit report', 'External audit report', 'Control testing report',
    'Data protection impact assessment|DPIA', 'Privacy notice', 'Consent record', 'Retention schedule', 'Legal hold notice',
    'Anti-bribery declaration', 'Sanctions screening record', 'Licence renewal|License renewal',
  ] },
  { key: 'SUPPORT_MAINTENANCE', name: 'Customer Support and Maintenance', area: 'OPERATIONS', module: 'projects', related: ['warranty', 'golive-support'], industries: ['all'], types: [
    'Support ticket', 'Incident ticket', 'Maintenance request', 'Field service report|FSR', 'Site visit report', 'Service completion report',
    'Preventive maintenance checklist|PM checklist', 'Corrective maintenance report', 'Replacement request', 'Spare parts request',
    'SLA breach report', 'Escalation record', 'Service acceptance certificate|HANDOVER',
  ] },
  { key: 'MEETINGS', name: 'Meetings and Collaboration', area: 'PM_REPORTING', module: 'projects', related: [], industries: ['all'], types: [
    'Meeting invitation', 'Agenda', 'Attendance record', 'Workshop notes', 'Review comments', 'Approval email|HANDOVER', 'Sign-off record|HANDOVER',
    'Presentation', 'Status deck|Status report', 'Clarification log', 'Stakeholder register', 'Communication matrix',
  ] },
  { key: 'ASSETS_INVENTORY', name: 'Assets and Inventory', area: 'OPERATIONS', module: 'assets', related: ['inventory', 'devices'], industries: ['all'], types: [
    'Asset register', 'Asset handover note', 'Asset transfer note', 'Serial number register', 'Installation certificate', 'Commissioning record',
    'Maintenance history', 'Warranty certificate', 'Spare parts list', 'Stock ledger', 'Inventory statement', 'Stock reconciliation',
    'Material issue slip', 'Disposal certificate', 'Asset retirement approval',
  ] },
  { key: 'CONSULTING', name: 'Consulting and Professional Services', area: 'PM_REPORTING', module: 'projects', related: ['proposals'], industries: ['consulting'], types: [
    'Consultancy proposal', 'Engagement letter|TENDER_CONTRACT', 'Research brief', 'Feasibility study|Feasibility report', 'Due diligence report',
    'Gap analysis', 'Benchmarking report', 'Survey results', 'Operating model', 'Transformation roadmap', 'Advisory report', 'Implementation plan',
    'Final consulting deliverable',
  ] },
  { key: 'PROPERTY_FACILITIES', name: 'Property and Facilities', area: 'OPERATIONS', module: 'assets', related: [], industries: ['real_estate', 'facilities'], types: [
    'Tenancy agreement|TENDER_CONTRACT', 'Rent invoice|FINANCE', 'Service charge statement|FINANCE', 'Property handover report|HANDOVER',
    'Facility inspection report', 'Building permit|SAFETY_COMPLIANCE', 'Occupancy certificate|OC|HANDOVER', 'Utility bill|FINANCE',
    'Facility management SLA', 'Access request', 'Fit-out approval', 'Floor plan|ENGINEERING', 'Property valuation report',
  ] },
  { key: 'MARKETING', name: 'Marketing and Agency Services', area: 'CORRESPONDENCE', module: 'marketing-campaigns', related: [], industries: ['marketing'], types: [
    'Marketing brief', 'Creative brief', 'Media plan', 'Campaign proposal', 'Advertising quotation', 'Insertion order|IO', 'Campaign report',
    'Content approval', 'Brand guidelines', 'Event proposal', 'Sponsorship agreement|TENDER_CONTRACT', 'Event run sheet', 'Agency invoice|FINANCE',
  ] },
  { key: 'PRODUCT_RESEARCH_IP', name: 'Product, Research and Intellectual Property', area: 'ENGINEERING', module: 'products', related: [], industries: ['all'], types: [
    'Product brief', 'Product roadmap', 'Prototype report', 'Proof-of-concept report|POC', 'Pilot report', 'Product specification',
    'Patent filing', 'Trademark registration', 'Copyright assignment', 'Invention disclosure', 'Licensing agreement|TENDER_CONTRACT',
    'Laboratory report|Lab report', 'Product certification',
  ] },
  { key: 'GOVERNMENT', name: 'Government and Public-Sector Documents', area: 'CORRESPONDENCE', module: 'projects', related: [], industries: ['government'], types: [
    'Government tender|TENDER_CONTRACT', 'Work allotment letter|TENDER_CONTRACT', 'Notice to proceed|NTP|TENDER_CONTRACT', 'Administrative approval|AA',
    'Expenditure sanction|ES', 'Budget allocation order', 'Technical sanction|TS', 'Revised sanction', 'Commencement order', 'Site handover memo|SITE',
    'Government contract agreement|TENDER_CONTRACT', 'Statutory permit|SAFETY_COMPLIANCE', 'No objection certificate|NOC|SAFETY_COMPLIANCE',
    'Environmental clearance|EC|SAFETY_COMPLIANCE', 'Land access approval|SAFETY_COMPLIANCE', 'Right-of-way approval|ROW|SAFETY_COMPLIANCE',
    'Utility shifting approval|SAFETY_COMPLIANCE', 'Road-cutting permission|SAFETY_COMPLIANCE', 'Tree-cutting permission|SAFETY_COMPLIANCE',
    'Design approval|ENGINEERING', 'Inspection notice|QUALITY', 'Test witness request|QUALITY', 'Material acceptance|QUALITY', 'Material rejection|QUALITY',
    'Progress review minutes|PM_REPORTING', 'Delay notice|PM_REPORTING', 'Recovery plan request|PM_REPORTING', 'Variation sanction',
    'EOT decision|PM_REPORTING', 'Bill passing memo|FINANCE', 'Fund release order|FINANCE', 'Audit query|SAFETY_COMPLIANCE', 'Audit reply|SAFETY_COMPLIANCE',
    'Vigilance notice|SAFETY_COMPLIANCE', 'Inspection objection|QUALITY', 'Compliance memo|SAFETY_COMPLIANCE', 'Utilization certificate|UC|FINANCE',
    'Commissioning approval|HANDOVER', 'Completion certificate|HANDOVER', 'Asset transfer|HANDOVER', 'Defects liability notice|DLP|HANDOVER',
    'Final audit compliance|SAFETY_COMPLIANCE', 'Project closure order|HANDOVER', 'Tender portal acknowledgement|TENDER_CONTRACT',
    'Digital signature record|DSC', 'Departmental correspondence',
  ] },
  { key: 'GENERAL', name: 'General and Emerging Documents', area: 'OTHER', module: null, related: [], industries: ['all'], types: [
    'Unidentified attachment', 'Document bundle', 'Archive file', 'Data export', 'Structured business data', 'Organization-specific record',
  ] },
]

// Extra acronym meanings that have NO single document type (or several), so a
// document is never routed on them alone. context = words that, when present
// in the document, support that meaning.
export const EXTRA_ACRONYMS = [
  { acronym: 'RPC', expansion: 'Revised project cost', industries: ['government', 'infrastructure'], context: ['sanction', 'revised', 'cost', 'estimate'] },
  { acronym: 'RPC', expansion: 'Remote procedure call', industries: ['it'], context: ['api', 'server', 'client', 'endpoint', 'grpc'] },
  { acronym: 'RPC', expansion: 'Rate per cubic metre / running payment certificate (organisation-specific — configure)', industries: ['construction'], context: ['bill', 'measurement', 'payment'] },
  { acronym: 'LD', expansion: 'Liquidated damages', industries: ['construction', 'government', 'all'], context: ['delay', 'deduction', 'contract', 'penalty'] },
  { acronym: 'PM', expansion: 'Preventive maintenance', industries: ['energy', 'manufacturing', 'facilities'], context: ['maintenance', 'checklist', 'schedule'] },
  { acronym: 'PM', expansion: 'Project manager', industries: ['all'], context: ['project', 'manager'] },
  { acronym: 'CS', expansion: 'Comparative statement', industries: ['all'], context: ['bidder', 'quotation', 'l1', 'comparison'] },
  { acronym: 'CS', expansion: 'Company secretary', industries: ['all'], context: ['board', 'resolution', 'secretary'] },
  { acronym: 'MS', expansion: 'Method statement', industries: ['construction'], context: ['method', 'sequence', 'activity'] },
  { acronym: 'MS', expansion: 'Mild steel', industries: ['construction', 'manufacturing'], context: ['steel', 'plate', 'kg', 'grade'] },
  { acronym: 'CO', expansion: 'Change order', industries: ['construction'], context: ['change', 'variation', 'scope'] },
  { acronym: 'CO', expansion: 'Certificate of origin', industries: ['logistics'], context: ['origin', 'export', 'customs'] },
  { acronym: 'PR', expansion: 'Purchase requisition', industries: ['all'], context: ['requisition', 'purchase', 'material'] },
  { acronym: 'PR', expansion: 'Public relations', industries: ['marketing'], context: ['media', 'press', 'campaign'] },
  { acronym: 'BRS', expansion: 'Bank reconciliation statement', industries: ['all'], context: ['bank', 'reconciliation', 'balance'] },
  { acronym: 'BRS', expansion: 'Business requirements specification', industries: ['it'], context: ['requirement', 'functional', 'stakeholder'] },
  { acronym: 'SAT', expansion: 'Site acceptance test', industries: ['manufacturing', 'energy', 'it'], context: ['test', 'acceptance', 'site'] },
  { acronym: 'ERP', expansion: 'Emergency response plan', industries: ['all'], context: ['emergency', 'evacuation', 'response'] },
  { acronym: 'ERP', expansion: 'Enterprise resource planning', industries: ['it'], context: ['software', 'module', 'implementation', 'sap', 'oracle'] },
]
