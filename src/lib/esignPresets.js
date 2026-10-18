// Agreements & e-Sign — ready-filled details for every built-in template:
// "Auto-fill details" in the editor and "Create all agreement types" on the
// list. Signers here are used only for the reference PDFs; drafts created in
// the app get no signers, so real ones are added before sending. Import-free.

const OUR_ADDRESS = 'No. 12, 3rd Floor, Tidel Park, Rajiv Gandhi Salai, Taramani, Chennai 600113'

export const PRESETS = {
  nda_mutual: {
    title: 'Mutual NDA with Sunrise Infra Projects',
    counterparty_name: 'Sunrise Infra Projects Pvt Ltd', sign_by: '2026-11-15',
    message: 'Sharing the NDA ahead of the smart water metering discussion. Please review and sign.',
    values: {
      company_address: OUR_ADDRESS, party_name: 'Sunrise Infra Projects Pvt Ltd',
      party_address: 'Plot 44, Phase II, Hinjewadi Rajiv Gandhi Infotech Park, Pune 411057',
      effective_date: '2026-10-20',
      purpose: 'evaluating a joint bid for the Pune Municipal Corporation smart water metering tender, including technical designs, pricing and customer data',
      term_years: '3', jurisdiction: 'Chennai',
    },
    signers: [
      { name: 'Anita Deshpande', email: 'anita.deshpande@sunriseinfra.in', role_label: 'Director, Sunrise Infra' },
      { name: 'Deepak Chowdary', email: 'deepak.chowdary@thingsalive.io', role_label: 'CEO, ThingsAlive' },
    ],
  },
  service_agreement: {
    title: 'IoT platform services agreement, Kaveri Foods',
    counterparty_name: 'Kaveri Foods Ltd', contract_value: 1440000,
    values: {
      company_address: OUR_ADDRESS, party_name: 'Kaveri Foods Ltd', party_address: 'Survey No. 118, Hosur Industrial Area, Hosur 635126',
      effective_date: '2026-11-01',
      services: 'Cold-chain temperature monitoring for 6 cold rooms and 22 reefer trucks: sensors on rental, NeoX dashboard and mobile app, SMS / email alerts, monthly compliance reports and 8x6 helpdesk support.',
      fees: '1440000', payment_terms: '30 days from the date of invoice, billed monthly in arrears', term_months: '12', notice_days: '30', jurisdiction: 'Chennai',
    },
    signers: [
      { name: 'Ramesh Iyer', email: 'ramesh.iyer@kaverifoods.in', role_label: 'Head of Operations, Kaveri Foods' },
      { name: 'Sulekha Dey', email: 'sulekha.dey@thingsalive.io', role_label: 'CEO, ThingsAlive' },
    ],
  },
  sow: {
    title: 'SOW: Fleet telematics rollout, Phase 1',
    counterparty_name: 'Metro Logistics Pvt Ltd', contract_value: 2850000,
    values: {
      company_address: OUR_ADDRESS, party_name: 'Metro Logistics Pvt Ltd', party_address: '7th Floor, Prestige Tower, Residency Road, Bengaluru 560025',
      effective_date: '2026-11-03', project_name: 'Fleet Telematics Rollout — Phase 1',
      master_agreement: 'the Master Service Agreement dated 1 September 2026',
      scope: 'Supply, install and commission GPS + CAN-bus telematics units on 250 trucks across the Bengaluru, Chennai and Hyderabad depots, integrate fuel-level sensors, and configure the NeoX fleet dashboard with driver scorecards and geofence alerts.',
      deliverables: '- 250 telematics units installed and live on the dashboard\n- Fuel sensor integration for 120 tankers\n- Driver behaviour scorecard and weekly report\n- Integration with Metro\'s SAP via REST API\n- Training for 15 depot supervisors and an admin handbook',
      out_of_scope: 'Vehicle electrical repairs, SIM data charges beyond 500 MB per unit per month, and changes to SAP.',
      milestones: '- 20% on signing\n- 40% on installation of 250 units (target 15 Dec 2026)\n- 30% on go-live and user acceptance (target 10 Jan 2027)\n- 10% after 30 days of stable operation',
      fees: '2850000', end_date: '2027-01-31', acceptance_days: '7',
    },
    signers: [
      { name: 'Karthik Rao', email: 'karthik.rao@metrologistics.in', role_label: 'VP Fleet, Metro Logistics' },
      { name: 'Sathish Kumar', email: 'sathishkumar.annadurai@thingsalive.io', role_label: 'Project Manager, ThingsAlive' },
    ],
  },
  purchase_order: {
    title: 'PO for LoRaWAN gateways and sensors',
    counterparty_name: 'Nova Embedded Systems', contract_value: 642156,
    values: {
      company_address: OUR_ADDRESS, party_name: 'Nova Embedded Systems', party_address: 'B-14, Ambattur Industrial Estate, Chennai 600058',
      po_number: 'PO-2026-0418', effective_date: '2026-10-22', vendor_gstin: '33AABCN1234F1Z5',
      delivery_address: 'ThingsAlive Stores, Plot 9, Guindy Industrial Estate, Chennai 600032', delivery_date: '2026-11-10',
      items: [
        { description: 'LoRaWAN outdoor gateway, 8-channel, IP67', qty: 12, unit: 'Nos', rate: 24500 },
        { description: 'Ultrasonic water level sensor, 4-20 mA', qty: 60, unit: 'Nos', rate: 3850 },
        { description: 'Pole-mount kit with surge protector', qty: 12, unit: 'Sets', rate: 1600 },
      ],
      gst_rate: '18', payment_terms: '30 days from receipt of goods and a valid tax invoice',
    },
    signers: [
      { name: 'Vignesh S', email: 'vignesh@novaembedded.in', role_label: 'Proprietor, Nova Embedded' },
      { name: 'Priya Natarajan', email: 'procurement@thingsalive.io', role_label: 'Procurement, ThingsAlive' },
    ],
  },
  work_order: {
    title: 'Work order: sensor installation at Plant 2',
    counterparty_name: 'Ravi Electricals', contract_value: 103781,
    values: {
      company_address: OUR_ADDRESS, party_name: 'Ravi Electricals', party_address: '22, Gandhi Road, Sriperumbudur 602105',
      wo_number: 'WO-2026-0057', effective_date: '2026-10-24', project_name: 'Energy Monitoring — Plant 2', site: 'Kaveri Foods Plant 2, Hosur',
      scope: 'Mount and wire 40 three-phase energy meters and 4 data gateways at the main LT panel and 12 sub-panels, run conduit and cable, label all circuits, and support commissioning with the ThingsAlive engineer.',
      start_date: '2026-10-28', end_date: '2026-11-12',
      items: [
        { description: 'Energy meter installation incl. CT mounting', qty: 40, unit: 'Nos', rate: 850 },
        { description: 'Armoured cable laying, 4C x 2.5 sq mm', qty: 600, unit: 'm', rate: 42 },
        { description: 'GI conduit with fittings', qty: 350, unit: 'm', rate: 65 },
        { description: 'Gateway mounting and power-up', qty: 4, unit: 'Nos', rate: 1500 },
      ],
      gst_rate: '18', retention_pct: '5', ld_pct: '0.5',
    },
    signers: [
      { name: 'Ravi Shankar', email: 'ravi@ravielectricals.in', role_label: 'Owner, Ravi Electricals' },
      { name: 'Arun Prakash', email: 'arun.prakash@thingsalive.io', role_label: 'Site Engineer, ThingsAlive' },
    ],
  },
  epc_contract: {
    title: 'EPC contract: 2 MW rooftop solar with monitoring',
    counterparty_name: 'Greenfield Textiles Ltd', contract_value: 86500000,
    values: {
      company_address: OUR_ADDRESS, party_name: 'Greenfield Textiles Ltd', party_address: 'SIPCOT Industrial Growth Centre, Perundurai, Erode 638052',
      effective_date: '2026-11-05', project_name: '2 MW Rooftop Solar PV Plant with IoT Monitoring', site: 'Greenfield Textiles, Perundurai — Units 1 to 4',
      scope: 'design and engineering of a 2 MWp grid-connected rooftop solar plant; supply of mono-PERC modules, string inverters, structures, cables and ACDB/DCDB; installation, net-metering liaison with TANGEDCO, testing and commissioning; and a NeoX IoT monitoring system with string-level analytics, weather station and 5 years of platform access.',
      contract_price: '86500000', completion_months: '6', advance_pct: '10', pbg_pct: '10', dlp_months: '24', ld_pct: '0.5', ld_cap_pct: '10', jurisdiction: 'Chennai',
    },
    signers: [
      { name: 'S. Murugesan', email: 'md@greenfieldtextiles.in', role_label: 'Managing Director, Greenfield Textiles' },
      { name: 'Deepak Chowdary', email: 'deepak.chowdary@thingsalive.io', role_label: 'CEO, ThingsAlive' },
    ],
  },
  msa: {
    title: 'Master service agreement, Metro Logistics',
    counterparty_name: 'Metro Logistics Pvt Ltd',
    values: {
      company_address: OUR_ADDRESS, party_name: 'Metro Logistics Pvt Ltd', party_address: '7th Floor, Prestige Tower, Residency Road, Bengaluru 560025',
      effective_date: '2026-09-01', term_years: '3', payment_days: '45', notice_days: '60', jurisdiction: 'Bengaluru',
      liability_cap: 'the fees paid under the relevant SOW in the 12 months before the claim',
    },
    signers: [
      { name: 'Neha Kapoor', email: 'neha.kapoor@metrologistics.in', role_label: 'General Counsel, Metro Logistics' },
      { name: 'Sulekha Dey', email: 'sulekha.dey@thingsalive.io', role_label: 'CEO, ThingsAlive' },
    ],
  },
  amc: {
    title: 'AMC for cold-chain monitoring, Kaveri Foods',
    counterparty_name: 'Kaveri Foods Ltd', contract_value: 360000,
    values: {
      company_address: OUR_ADDRESS, party_name: 'Kaveri Foods Ltd', party_address: 'Survey No. 118, Hosur Industrial Area, Hosur 635126',
      effective_date: '2026-11-01', end_date: '2027-10-31',
      covered_assets: '- 48 wireless temperature / humidity sensors (cold rooms 1-6)\n- 6 LoRaWAN gateways\n- 22 reefer truck trackers\n- NeoX monitoring dashboard and alerting',
      site: 'Kaveri Foods Plant 1 and Plant 2, Hosur', visits_per_year: '4', response_hours: '4', resolution_hours: '24', uptime_pct: '98',
      amc_fee: '360000', billing: 'quarterly in advance',
    },
    signers: [
      { name: 'Ramesh Iyer', email: 'ramesh.iyer@kaverifoods.in', role_label: 'Head of Operations, Kaveri Foods' },
      { name: 'Sathish Kumar', email: 'support@thingsalive.io', role_label: 'Support Head, ThingsAlive' },
    ],
  },
  amendment: {
    title: 'Amendment 1 to Fleet telematics SOW',
    counterparty_name: 'Metro Logistics Pvt Ltd', contract_value: 570000,
    values: {
      company_address: OUR_ADDRESS, party_name: 'Metro Logistics Pvt Ltd', party_address: '7th Floor, Prestige Tower, Residency Road, Bengaluru 560025',
      effective_date: '2026-12-01', amendment_no: '1',
      original_agreement: 'the Statement of Work "Fleet Telematics Rollout — Phase 1" dated 3 November 2026',
      reason: 'Metro Logistics has added its new Coimbatore depot and asked for 50 more vehicles to be covered in Phase 1.',
      changes: '- Clause 1 (Scope): "250 trucks" is replaced by "300 trucks", adding the Coimbatore depot.\n- Clause 5 (Fees): total fees increase by INR 5,70,000 to INR 34,20,000 plus GST.\n- Clause 4 (Timeline): completion date moves from 31 January 2027 to 28 February 2027.',
    },
    signers: [
      { name: 'Karthik Rao', email: 'karthik.rao@metrologistics.in', role_label: 'VP Fleet, Metro Logistics' },
      { name: 'Sathish Kumar', email: 'sathishkumar.annadurai@thingsalive.io', role_label: 'Project Manager, ThingsAlive' },
    ],
  },
}

export const presetFor = key => PRESETS[key] || null
