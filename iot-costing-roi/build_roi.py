"""
build_roi.py — ROI Inputs / Current vs New / Site-by-Site ROI / ROI
Summary tabs, added to the same workbook build_costing.py builds.

inputs.py has no benefit-side figures at all yet (no fuel-savings %,
downtime hours, manpower hours, or the additional benefit category/value)
— every row on the ROI Inputs tab is therefore a real, live NEEDS-INPUT
placeholder (yellow-flagged, defaulted to 0/blank), not an invented
number. Total Annual Savings, Net Annual Benefit and Payback will compute
to 0 / negative / "N/A" until real figures replace them — that is the
correct, honest behavior given what's actually known right now, not a bug.

Site-by-Site ROI has no real site names/fleet splits either — it ships as
three explicitly-labeled placeholder rows (blue + yellow "NEEDS INPUT"),
never a generic "scale to N sites" formula, per the brief.
"""
import inputs
from styles import as_input, as_formula, as_link, flag_needs_input, header, CURRENCY_FMT, PERCENT_FMT, NUMBER_FMT

# (row_label, driven_by_device) — the benefit lines wired per the brief:
# fuel savings <- Fuel Sensor; uptime gain <- Temp/Pressure/Hydraulic
# Sensors + IoT Logger alerts; dispatch accuracy <- QR Scanner + SaaS.
BENEFIT_LINES = [
    ('Fuel Savings (₹/year)', 'Fuel Sensor'),
    ('Downtime Cost Avoided (₹/year)', 'Temperature / Pressure / Hydraulic Sensor + IoT Logger Alerts'),
    ('Manpower Cost Saved (₹/year)', 'QR Scanner + SaaS Platform (dispatch accuracy)'),
]


def _additional_benefit_row():
    category = getattr(inputs, 'ADDITIONAL_BENEFIT_CATEGORY', None) or '(Additional Benefit Category — NEEDS INPUT FROM SATHISHKUMAR)'
    driver = getattr(inputs, 'ADDITIONAL_BENEFIT_DRIVER_DEVICE', None) or '(NEEDS INPUT — which device/sensor drives this)'
    value = getattr(inputs, 'ADDITIONAL_BENEFIT_VALUE', None)
    return category, driver, value


def build_roi_inputs_tab(wb):
    ws = wb.create_sheet('ROI Inputs')
    for col, w in zip('ABC', (34, 18, 46)):
        ws.column_dimensions[col].width = w
    for c, label in enumerate(['Benefit Line', 'Value (₹/year)', 'Driven By'], start=1):
        header(ws.cell(row=1, column=c), label)

    row = 2
    value_refs = []
    for label, driver in BENEFIT_LINES:
        ws.cell(row=row, column=1, value=label)
        value_cell = ws.cell(row=row, column=2, value=0)
        as_input(value_cell, CURRENCY_FMT)
        flag_needs_input(value_cell)
        ws.cell(row=row, column=3, value=driver)
        value_refs.append(f'B{row}')
        row += 1

    additional_category, additional_driver, additional_value = _additional_benefit_row()
    ws.cell(row=row, column=1, value=additional_category)
    value_cell = ws.cell(row=row, column=2, value=additional_value if additional_value is not None else 0)
    as_input(value_cell, CURRENCY_FMT)
    if additional_value is None:
        flag_needs_input(value_cell)
    ws.cell(row=row, column=3, value=additional_driver)
    value_refs.append(f'B{row}')
    row += 1

    total_row = row
    ws.cell(row=total_row, column=1, value='Total Annual Savings')
    as_formula(ws.cell(row=total_row, column=2, value=f'=SUM({value_refs[0]}:{value_refs[-1]})'), bold=True)

    return {
        'benefit_rows': list(zip([l for l, _ in BENEFIT_LINES] + [additional_category], value_refs)),
        'total_ref': f"'ROI Inputs'!B{total_row}",
    }


def build_current_vs_new_tab(wb, roi_inputs):
    ws = wb.create_sheet('Current vs New')
    for col, w in zip('ABCD', (30, 20, 20, 20)):
        ws.column_dimensions[col].width = w
    for c, label in enumerate(['Line', 'Current State (without IoT)', 'Savings / Benefit', 'New State (with IoT)'], start=1):
        header(ws.cell(row=1, column=c), label)

    row = 2
    for label, value_ref in roi_inputs['benefit_rows']:
        ws.cell(row=row, column=1, value=label)
        current_cell = ws.cell(row=row, column=2, value=0)
        as_input(current_cell, CURRENCY_FMT)
        flag_needs_input(current_cell, 'NEEDS INPUT FROM SATHISHKUMAR — current (pre-IoT) baseline for this line')
        as_link(ws.cell(row=row, column=3, value=f'={value_ref}'))
        as_formula(ws.cell(row=row, column=4, value=f'=B{row}-C{row}'))
        row += 1


def build_site_by_site_tab(wb, refs, roi_inputs):
    """Placeholder site rows — literal, labeled, NOT a generic scale-to-N formula."""
    ws = wb.create_sheet('Site-by-Site ROI')
    for col, w in zip('ABCDE', (30, 12, 18, 18, 16)):
        ws.column_dimensions[col].width = w
    for c, label in enumerate(['Site', 'Fleet Count', 'Allocated Cost', 'Allocated Savings', 'Payback (months)'], start=1):
        header(ws.cell(row=1, column=c), label)

    n_placeholder_sites = 3
    row = 2
    first = row
    for i in range(1, n_placeholder_sites + 1):
        site_cell = ws.cell(row=row, column=1, value=f'(Site {i} — NEEDS INPUT FROM SATHISHKUMAR: real site name)')
        flag_needs_input(site_cell, 'NEEDS INPUT FROM SATHISHKUMAR — real site name')
        fleet_cell = ws.cell(row=row, column=2, value=0)
        as_input(fleet_cell, NUMBER_FMT)
        flag_needs_input(fleet_cell, 'NEEDS INPUT FROM SATHISHKUMAR — vehicle count at this site')
        as_formula(ws.cell(row=row, column=3, value=f"=IFERROR(B{row}/'Inputs'!{refs['FLEET_QTY']}*'Proposal Cost Summary'!B8,0)"))
        as_formula(ws.cell(row=row, column=4, value=f"=IFERROR(B{row}/'Inputs'!{refs['FLEET_QTY']}*{roi_inputs['total_ref']},0)"))
        as_formula(ws.cell(row=row, column=5, value=f'=IFERROR(C{row}/(D{row}/12),"N/A")'), NUMBER_FMT)
        row += 1
    last = row - 1

    ws.cell(row=row, column=1, value='TOTAL (placeholder sites)')
    as_formula(ws.cell(row=row, column=2, value=f'=SUM(B{first}:B{last})'), NUMBER_FMT, bold=True)
    as_formula(ws.cell(row=row, column=3, value=f'=SUM(C{first}:C{last})'), bold=True)
    as_formula(ws.cell(row=row, column=4, value=f'=SUM(D{first}:D{last})'), bold=True)


def build_roi_summary_tab(wb, roi_inputs):
    ws = wb.create_sheet('ROI Summary')
    for col, w in zip('AB', (34, 20)):
        ws.column_dimensions[col].width = w
    header(ws.cell(row=1, column=1), 'ROI Summary')

    ws.cell(row=2, column=1, value='Total Investment')
    as_link(ws.cell(row=2, column=2, value="='Proposal Cost Summary'!B8"), CURRENCY_FMT)

    ws.cell(row=3, column=1, value='Total Annual Savings')
    as_link(ws.cell(row=3, column=2, value=f"={roi_inputs['total_ref']}"), CURRENCY_FMT)

    ws.cell(row=4, column=1, value='Recurring Annual Cost (SaaS + Maintenance, at Price)')
    as_link(ws.cell(row=4, column=2, value="='Proposal Cost Summary'!B5"), CURRENCY_FMT)

    ws.cell(row=5, column=1, value='Net Annual Benefit')
    as_formula(ws.cell(row=5, column=2, value='=B3-B4'), bold=True)

    ws.cell(row=6, column=1, value='Payback Period (months)')
    as_formula(ws.cell(row=6, column=2, value='=IFERROR(B2/(B5/12),"N/A — no positive net benefit yet")'), NUMBER_FMT)

    ws.cell(row=7, column=1, value='3-Year Cumulative ROI %')
    as_formula(ws.cell(row=7, column=2, value='=IFERROR((B5*3-B2)/B2,"N/A")'), PERCENT_FMT, bold=True)


def build_roi_tabs(wb, refs):
    roi_inputs = build_roi_inputs_tab(wb)
    build_current_vs_new_tab(wb, roi_inputs)
    build_site_by_site_tab(wb, refs, roi_inputs)
    build_roi_summary_tab(wb, roi_inputs)
