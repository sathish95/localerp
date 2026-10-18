"""
build.py — entry point. Runs build_costing.py then build_roi.py against
one workbook, saves it, and recalculates via recalc.py (fails loudly on
any formula error).

Run with --skip-recalc to just write the file without the LibreOffice
round-trip (useful if LibreOffice isn't installed on this machine yet —
see recalc.py / README.md).
"""
import sys

from openpyxl import Workbook

from build_costing import build_costing_tabs
from build_roi import build_roi_tabs
from recalc import recalculate, check_for_errors

OUT_PATH = 'ThingsAlive_IoT_Fleet_Logger_Costing_ROI.xlsx'


def main():
    skip_recalc = '--skip-recalc' in sys.argv

    wb = Workbook()
    refs = build_costing_tabs(wb)
    build_roi_tabs(wb, refs)
    wb.remove(wb['Sheet'])  # drop openpyxl's default blank sheet
    wb.save(OUT_PATH)
    print(f'Wrote {OUT_PATH}')

    if skip_recalc:
        print('Skipped LibreOffice recalculation (--skip-recalc) — formulas are written but not yet computed/verified.')
        return

    recalculate(OUT_PATH)
    check_for_errors(OUT_PATH)
    print(f'Recalculated and verified with no formula errors: {OUT_PATH}')


if __name__ == '__main__':
    main()
