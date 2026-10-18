"""
test_totals.py — the regression check: after build.py generates and
recalculates the workbook, these known totals must still hold. Run this
any time inputs.py changes to catch a formula that silently broke.

Looks a sheet/row up by label rather than hardcoding cell coordinates
(e.g. "Overall Summary"'s TOTAL row, "Proposal Cost Summary"'s
GrandTotal), so it keeps working even if a column gets inserted —
the exact labels/layout will be confirmed once build_costing.py exists.
"""
import sys
from pathlib import Path

import pytest
from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from inputs import TOTAL_FIRST_YEAR_COST, GRAND_TOTAL  # noqa: E402

WORKBOOK_PATH = Path(__file__).resolve().parent.parent / 'ThingsAlive_IoT_Fleet_Logger_Costing_ROI.xlsx'


def _find_value_after_label(sheet, label):
    """Scans a sheet for a cell whose text matches `label` (case-insensitive), returns the next cell's value in that row."""
    for row in sheet.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.strip().lower() == label.lower():
                next_cell = sheet.cell(row=cell.row, column=cell.column + 1)
                return next_cell.value
    return None


def _find_value_at_row_label_col_header(sheet, row_label, col_header):
    """Finds the row whose first cell matches row_label, and the column whose header row matches col_header — for sheets with more than one value column per row (e.g. Overall Summary's Cost vs Price)."""
    header_col = None
    for cell in sheet[1]:
        if isinstance(cell.value, str) and cell.value.strip().lower() == col_header.lower():
            header_col = cell.column
            break
    if header_col is None:
        return None
    for row in sheet.iter_rows():
        first_cell = row[0]
        if isinstance(first_cell.value, str) and first_cell.value.strip().lower() == row_label.lower():
            return sheet.cell(row=first_cell.row, column=header_col).value
    return None


@pytest.fixture(scope='module')
def workbook():
    if not WORKBOOK_PATH.exists():
        pytest.skip(f'{WORKBOOK_PATH.name} has not been built yet — run build.py first.')
    return load_workbook(WORKBOOK_PATH, data_only=True)


def test_total_first_year_cost(workbook):
    # "Total First-Year Cost" is the customer-facing PRICE total, not the
    # internal cost total — Overall Summary has both side by side, so this
    # looks up the "Total Price" column specifically, not just "the next cell".
    sheet = workbook['Overall Summary']
    value = _find_value_at_row_label_col_header(sheet, 'TOTAL', 'Total Price')
    assert value is not None, '"TOTAL" row / "Total Price" column not found on Overall Summary'
    assert round(value, 2) == round(TOTAL_FIRST_YEAR_COST, 2)


def test_grand_total(workbook):
    sheet = workbook['Proposal Cost Summary']
    value = _find_value_after_label(sheet, 'Grand Total')
    assert value is not None, '"Grand Total" row not found on Proposal Cost Summary'
    assert round(value, 2) == round(GRAND_TOTAL, 2)
