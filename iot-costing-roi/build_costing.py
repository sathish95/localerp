"""
build_costing.py — builds the costing tabs: Inputs / IoT Logger Cost /
Sensor Cost / SaaS Cost / Dev & Maintenance / QR Device / Installation /
Overall Summary / Proposal Cost Summary.

IMPORTANT — read before trusting the totals this produces: no reference
workbook was available to confirm the real formula structure (margin
convention, which lines scale by FLEET_QTY, install method, multi-year
split). Every cell is still a real formula referencing the Inputs tab —
nothing is a hardcoded literal — but the *structure* itself (documented
inline below) is this generator's own reasonable default, not a confirmed
fact:
  - margin convention: unit_price = unit_cost * (1 + margin)
  - per-category quantities (fuel/temp/pressure/hydraulic sensor counts,
    QR device count, install duration, project duration years) are the
    NEEDS-INPUT placeholders from inputs.py — yellow-flagged on the
    Inputs tab, defaulted to something that keeps every formula valid
    (usually FLEET_QTY or 0) rather than a guessed real number.
Until those are filled in with real figures, Total First-Year Cost and
Grand Total will NOT equal the known reference totals — that's expected,
not a bug; tests/test_totals.py will fail until then, which is the point.
"""
import inputs
from styles import (
    as_input, as_formula, as_link, flag_needs_input, header,
    CURRENCY_FMT, PERCENT_FMT, NUMBER_FMT,
)

# Every (constant_name, label, number_format, needs_input) row written to
# the Inputs tab, in order. `needs_input` cells get the yellow flag.
INPUT_ROWS = [
    ('FLEET_QTY', 'Fleet Quantity', NUMBER_FMT, False),
    ('IOT_LOGGER_COST', 'IoT Logger Unit Cost', CURRENCY_FMT, False),
    ('IOT_LOGGER_MARGIN', 'IoT Logger Margin', PERCENT_FMT, False),
    ('FIRMWARE_APP_COST', 'Firmware/App Dev Cost', CURRENCY_FMT, False),
    ('SAP_COST', 'SAP Integration Cost', CURRENCY_FMT, False),
    ('DEV_MARGIN', 'Dev Margin', PERCENT_FMT, False),
    ('MAINTENANCE_COST', 'Maintenance Cost', CURRENCY_FMT, False),
    ('MAINTENANCE_MARGIN', 'Maintenance Margin', PERCENT_FMT, False),
    ('QR_DEVICE_COST', 'QR Device Unit Cost', CURRENCY_FMT, False),
    ('QR_MARGIN', 'QR Device Margin', PERCENT_FMT, False),
    ('SAAS_PLATFORM', 'SaaS Platform (per unit/month)', CURRENCY_FMT, False),
    ('SAAS_SMS', 'SaaS SMS (per unit/month)', CURRENCY_FMT, False),
    ('SAAS_SIM', 'SaaS SIM (per unit/month)', CURRENCY_FMT, False),
    ('SAAS_MARGIN', 'SaaS Margin', PERCENT_FMT, False),
    ('FUEL_SENSOR_COST', 'Fuel Sensor Unit Cost', CURRENCY_FMT, False),
    ('FUEL_SENSOR_MARGIN', 'Fuel Sensor Margin', PERCENT_FMT, False),
    ('TEMP_SENSOR_COST', 'Temperature Sensor Unit Cost', CURRENCY_FMT, False),
    ('TEMP_SENSOR_MARGIN', 'Temperature Sensor Margin', PERCENT_FMT, False),
    ('PRESSURE_SENSOR_COST', 'Pressure Sensor Unit Cost', CURRENCY_FMT, False),
    ('PRESSURE_SENSOR_MARGIN', 'Pressure Sensor Margin', PERCENT_FMT, False),
    ('HYDRAULIC_SENSOR_COST', 'Hydraulic Sensor Unit Cost', CURRENCY_FMT, False),
    ('HYDRAULIC_SENSOR_MARGIN', 'Hydraulic Sensor Margin', PERCENT_FMT, False),
    ('INSTALL_RATE_PER_DAY', 'Install Rate / Day', CURRENCY_FMT, False),
    ('INSTALL_MONTHLY', 'Install Rate / Month', CURRENCY_FMT, False),
    ('FUEL_SENSOR_QTY', 'Fuel Sensor Qty (vehicles fitted)', NUMBER_FMT, True),
    ('TEMP_SENSOR_QTY', 'Temp Sensor Qty (vehicles fitted)', NUMBER_FMT, True),
    ('PRESSURE_SENSOR_QTY', 'Pressure Sensor Qty (vehicles fitted)', NUMBER_FMT, True),
    ('HYDRAULIC_SENSOR_QTY', 'Hydraulic Sensor Qty (vehicles fitted)', NUMBER_FMT, True),
    ('QR_DEVICE_QTY', 'QR Device Qty', NUMBER_FMT, True),
    ('INSTALL_DAYS', 'Install Days (at Install Rate / Day)', NUMBER_FMT, True),
    ('INSTALL_MONTHS', 'Install Months (at Install Rate / Month)', NUMBER_FMT, True),
    ('SAAS_MONTHS_PER_YEAR', 'SaaS Months / Year', NUMBER_FMT, False),
    ('PROJECT_DURATION_YEARS', 'Project Duration (years, for Grand Total)', NUMBER_FMT, True),
]


def build_inputs_tab(wb):
    """Writes every inputs.py constant as a labeled blue cell. Returns {constant_name: 'B{row}'} for other tabs to link against."""
    ws = wb.create_sheet('Inputs')
    ws.column_dimensions['A'].width = 42
    ws.column_dimensions['B'].width = 18
    ws.column_dimensions['C'].width = 3
    header(ws.cell(row=1, column=1), 'Label')
    header(ws.cell(row=1, column=2), 'Value')

    cell_refs = {}
    row = 2
    for const_name, label, fmt, needs_input in INPUT_ROWS:
        ws.cell(row=row, column=1, value=label)
        value_cell = ws.cell(row=row, column=2, value=getattr(inputs, const_name))
        as_input(value_cell, fmt)
        if needs_input:
            flag_needs_input(value_cell)
        cell_refs[const_name] = f'B{row}'
        row += 1
    return cell_refs


def _link(ws, row, col, source_ref, fmt=CURRENCY_FMT):
    cell = ws.cell(row=row, column=col, value=f"='Inputs'!{source_ref}")
    return as_link(cell, fmt)


def _formula(ws, row, col, formula, fmt=CURRENCY_FMT, bold=False):
    cell = ws.cell(row=row, column=col, value=formula)
    return as_formula(cell, fmt, bold=bold)


def build_iot_logger_tab(wb, refs):
    ws = wb.create_sheet('IoT Logger Cost')
    for col, w in zip('AB', (28, 18)):
        ws.column_dimensions[col].width = w
    header(ws.cell(row=1, column=1), 'IoT Logger Cost')

    rows = [
        ('Fleet Qty', refs['FLEET_QTY'], NUMBER_FMT),
        ('Unit Cost', refs['IOT_LOGGER_COST'], CURRENCY_FMT),
        ('Margin', refs['IOT_LOGGER_MARGIN'], PERCENT_FMT),
    ]
    for i, (label, ref, fmt) in enumerate(rows, start=2):
        ws.cell(row=i, column=1, value=label)
        _link(ws, i, 2, ref, fmt)

    ws.cell(row=5, column=1, value='Unit Price')
    _formula(ws, 5, 2, '=B3*(1+B4)')
    ws.cell(row=6, column=1, value='Total Cost')
    _formula(ws, 6, 2, '=B3*B2')
    ws.cell(row=7, column=1, value='Total Price')
    _formula(ws, 7, 2, '=B5*B2', bold=True)
    return {'total_cost_ref': "'IoT Logger Cost'!B6", 'total_price_ref': "'IoT Logger Cost'!B7"}


SENSORS = [
    ('Fuel Sensor', 'FUEL_SENSOR_COST', 'FUEL_SENSOR_MARGIN', 'FUEL_SENSOR_QTY'),
    ('Temperature Sensor', 'TEMP_SENSOR_COST', 'TEMP_SENSOR_MARGIN', 'TEMP_SENSOR_QTY'),
    ('Pressure Sensor', 'PRESSURE_SENSOR_COST', 'PRESSURE_SENSOR_MARGIN', 'PRESSURE_SENSOR_QTY'),
    ('Hydraulic Sensor', 'HYDRAULIC_SENSOR_COST', 'HYDRAULIC_SENSOR_MARGIN', 'HYDRAULIC_SENSOR_QTY'),
]


def build_sensor_tab(wb, refs):
    ws = wb.create_sheet('Sensor Cost')
    for col, w in zip('ABCDEFG', (22, 12, 14, 10, 14, 14, 14)):
        ws.column_dimensions[col].width = w
    for c, label in enumerate(['Sensor', 'Qty', 'Unit Cost', 'Margin', 'Unit Price', 'Total Cost', 'Total Price'], start=1):
        header(ws.cell(row=1, column=c), label)

    row = 2
    first_data_row = row
    for name, cost_key, margin_key, qty_key in SENSORS:
        ws.cell(row=row, column=1, value=name)
        _link(ws, row, 2, refs[qty_key], NUMBER_FMT)
        _link(ws, row, 3, refs[cost_key], CURRENCY_FMT)
        _link(ws, row, 4, refs[margin_key], PERCENT_FMT)
        _formula(ws, row, 5, f'=C{row}*(1+D{row})')
        _formula(ws, row, 6, f'=C{row}*B{row}')
        _formula(ws, row, 7, f'=E{row}*B{row}')
        row += 1
    last_data_row = row - 1

    ws.cell(row=row, column=1, value='TOTAL')
    _formula(ws, row, 6, f'=SUM(F{first_data_row}:F{last_data_row})', bold=True)
    _formula(ws, row, 7, f'=SUM(G{first_data_row}:G{last_data_row})', bold=True)
    return {'total_cost_ref': f"'Sensor Cost'!F{row}", 'total_price_ref': f"'Sensor Cost'!G{row}"}


def build_saas_tab(wb, refs):
    ws = wb.create_sheet('SaaS Cost')
    for col, w in zip('AB', (30, 18)):
        ws.column_dimensions[col].width = w
    header(ws.cell(row=1, column=1), 'SaaS Cost')

    ws.cell(row=2, column=1, value='Platform (per unit/month)')
    _link(ws, 2, 2, refs['SAAS_PLATFORM'])
    ws.cell(row=3, column=1, value='SMS (per unit/month)')
    _link(ws, 3, 2, refs['SAAS_SMS'])
    ws.cell(row=4, column=1, value='SIM (per unit/month)')
    _link(ws, 4, 2, refs['SAAS_SIM'])
    ws.cell(row=5, column=1, value='Combined Unit Cost / Month')
    _formula(ws, 5, 2, '=SUM(B2:B4)')
    ws.cell(row=6, column=1, value='Margin')
    _link(ws, 6, 2, refs['SAAS_MARGIN'], PERCENT_FMT)
    ws.cell(row=7, column=1, value='Unit Price / Month')
    _formula(ws, 7, 2, '=B5*(1+B6)')
    ws.cell(row=8, column=1, value='Fleet Qty')
    _link(ws, 8, 2, refs['FLEET_QTY'], NUMBER_FMT)
    ws.cell(row=9, column=1, value='Total Cost / Month')
    _formula(ws, 9, 2, '=B5*B8')
    ws.cell(row=10, column=1, value='Total Price / Month')
    _formula(ws, 10, 2, '=B7*B8')
    ws.cell(row=11, column=1, value='Months / Year')
    _link(ws, 11, 2, refs['SAAS_MONTHS_PER_YEAR'], NUMBER_FMT)
    ws.cell(row=12, column=1, value='Annual Total Cost')
    _formula(ws, 12, 2, '=B9*B11')
    ws.cell(row=13, column=1, value='Annual Total Price')
    _formula(ws, 13, 2, '=B10*B11', bold=True)
    return {'total_cost_ref': "'SaaS Cost'!B12", 'total_price_ref': "'SaaS Cost'!B13"}


def build_dev_maintenance_tab(wb, refs):
    ws = wb.create_sheet('Dev & Maintenance')
    for col, w in zip('AB', (30, 18)):
        ws.column_dimensions[col].width = w
    header(ws.cell(row=1, column=1), 'Dev & Maintenance')

    ws.cell(row=2, column=1, value='Firmware/App Dev Cost')
    _link(ws, 2, 2, refs['FIRMWARE_APP_COST'])
    ws.cell(row=3, column=1, value='SAP Integration Cost')
    _link(ws, 3, 2, refs['SAP_COST'])
    ws.cell(row=4, column=1, value='Dev Subtotal (Cost)')
    _formula(ws, 4, 2, '=SUM(B2:B3)')
    ws.cell(row=5, column=1, value='Dev Margin')
    _link(ws, 5, 2, refs['DEV_MARGIN'], PERCENT_FMT)
    ws.cell(row=6, column=1, value='Dev Total Price')
    _formula(ws, 6, 2, '=B4*(1+B5)')

    ws.cell(row=8, column=1, value='Maintenance Cost')
    _link(ws, 8, 2, refs['MAINTENANCE_COST'])
    ws.cell(row=9, column=1, value='Maintenance Margin')
    _link(ws, 9, 2, refs['MAINTENANCE_MARGIN'], PERCENT_FMT)
    ws.cell(row=10, column=1, value='Maintenance Price')
    _formula(ws, 10, 2, '=B8*(1+B9)')

    ws.cell(row=12, column=1, value='Combined Total Cost')
    _formula(ws, 12, 2, '=B4+B8', bold=True)
    ws.cell(row=13, column=1, value='Combined Total Price')
    _formula(ws, 13, 2, '=B6+B10', bold=True)
    return {'total_cost_ref': "'Dev & Maintenance'!B12", 'total_price_ref': "'Dev & Maintenance'!B13"}


def build_qr_device_tab(wb, refs):
    ws = wb.create_sheet('QR Device')
    for col, w in zip('AB', (24, 18)):
        ws.column_dimensions[col].width = w
    header(ws.cell(row=1, column=1), 'QR Device')

    ws.cell(row=2, column=1, value='Unit Cost')
    _link(ws, 2, 2, refs['QR_DEVICE_COST'])
    ws.cell(row=3, column=1, value='Margin')
    _link(ws, 3, 2, refs['QR_MARGIN'], PERCENT_FMT)
    ws.cell(row=4, column=1, value='Qty')
    _link(ws, 4, 2, refs['QR_DEVICE_QTY'], NUMBER_FMT)
    ws.cell(row=5, column=1, value='Unit Price')
    _formula(ws, 5, 2, '=B2*(1+B3)')
    ws.cell(row=6, column=1, value='Total Cost')
    _formula(ws, 6, 2, '=B2*B4')
    ws.cell(row=7, column=1, value='Total Price')
    _formula(ws, 7, 2, '=B5*B4', bold=True)
    return {'total_cost_ref': "'QR Device'!B6", 'total_price_ref': "'QR Device'!B7"}


def build_installation_tab(wb, refs):
    ws = wb.create_sheet('Installation')
    for col, w in zip('AB', (30, 18)):
        ws.column_dimensions[col].width = w
    header(ws.cell(row=1, column=1), 'Installation')

    ws.cell(row=2, column=1, value='Rate / Day')
    _link(ws, 2, 2, refs['INSTALL_RATE_PER_DAY'])
    ws.cell(row=3, column=1, value='Install Days')
    _link(ws, 3, 2, refs['INSTALL_DAYS'], NUMBER_FMT)
    ws.cell(row=4, column=1, value='Cost via Daily Rate')
    _formula(ws, 4, 2, '=B2*B3')

    ws.cell(row=6, column=1, value='Rate / Month')
    _link(ws, 6, 2, refs['INSTALL_MONTHLY'])
    ws.cell(row=7, column=1, value='Install Months')
    _link(ws, 7, 2, refs['INSTALL_MONTHS'], NUMBER_FMT)
    ws.cell(row=8, column=1, value='Cost via Monthly Rate')
    _formula(ws, 8, 2, '=B6*B7')

    ws.cell(row=10, column=1, value='Total Installation Cost')
    _formula(ws, 10, 2, '=B4+B8', bold=True)
    # No margin concept given for installation — cost is passed straight
    # through as price (ASSUMPTION: installation is billed at cost).
    return {'total_cost_ref': "'Installation'!B10", 'total_price_ref': "'Installation'!B10"}


def build_overall_summary_tab(wb, category_totals):
    """category_totals: [(label, total_cost_ref, total_price_ref), ...]"""
    ws = wb.create_sheet('Overall Summary')
    for col, w in zip('ABC', (26, 18, 18)):
        ws.column_dimensions[col].width = w
    for c, label in enumerate(['Category', 'Total Cost', 'Total Price'], start=1):
        header(ws.cell(row=1, column=c), label)

    row = 2
    first = row
    for label, cost_ref, price_ref in category_totals:
        ws.cell(row=row, column=1, value=label)
        as_link(ws.cell(row=row, column=2, value=f'={cost_ref}'))
        as_link(ws.cell(row=row, column=3, value=f'={price_ref}'))
        row += 1
    last = row - 1

    ws.cell(row=row, column=1, value='TOTAL')
    _formula(ws, row, 2, f'=SUM(B{first}:B{last})', bold=True)
    _formula(ws, row, 3, f'=SUM(C{first}:C{last})', bold=True)
    return {'total_price_ref': f"'Overall Summary'!C{row}"}


def build_proposal_cost_summary_tab(wb, overall_total_price_ref, saas_total_price_ref, refs):
    ws = wb.create_sheet('Proposal Cost Summary')
    for col, w in zip('AB', (32, 18)):
        ws.column_dimensions[col].width = w
    header(ws.cell(row=1, column=1), 'Proposal Cost Summary')

    ws.cell(row=2, column=1, value='Total First-Year Cost')
    _formula(ws, 2, 2, f'={overall_total_price_ref}', bold=True)

    ws.cell(row=4, column=1, value='Project Duration (years)')
    _link(ws, 4, 2, refs['PROJECT_DURATION_YEARS'], NUMBER_FMT)
    ws.cell(row=5, column=1, value='Recurring Categories, Annual (SaaS + Maintenance, at Price)')
    _formula(ws, 5, 2, f"={saas_total_price_ref}+'Dev & Maintenance'!B10")
    ws.cell(row=6, column=1, value='Additional Years Beyond Year 1')
    _formula(ws, 6, 2, '=MAX(B4-1,0)*B5')

    ws.cell(row=8, column=1, value='Grand Total')
    _formula(ws, 8, 2, '=B2+B6', bold=True)


def build_costing_tabs(wb):
    refs = build_inputs_tab(wb)
    iot = build_iot_logger_tab(wb, refs)
    sensors = build_sensor_tab(wb, refs)
    saas = build_saas_tab(wb, refs)
    dev_maint = build_dev_maintenance_tab(wb, refs)
    qr = build_qr_device_tab(wb, refs)
    install = build_installation_tab(wb, refs)

    category_totals = [
        ('IoT Logger', iot['total_cost_ref'], iot['total_price_ref']),
        ('Sensors', sensors['total_cost_ref'], sensors['total_price_ref']),
        ('SaaS (Annual)', saas['total_cost_ref'], saas['total_price_ref']),
        ('Dev & Maintenance', dev_maint['total_cost_ref'], dev_maint['total_price_ref']),
        ('QR Device', qr['total_cost_ref'], qr['total_price_ref']),
        ('Installation', install['total_cost_ref'], install['total_price_ref']),
    ]
    overall = build_overall_summary_tab(wb, category_totals)
    build_proposal_cost_summary_tab(wb, overall['total_price_ref'], saas['total_price_ref'], refs)
    return refs
