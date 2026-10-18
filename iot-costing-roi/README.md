# ThingsAlive IoT Fleet Logger — Costing + ROI Generator

Regenerates the costing + ROI workbook from `inputs.py` whenever a figure
changes — re-run it in VS Code, get a fresh, fully-formula-linked `.xlsx`,
verified against known totals.

## Status

`inputs.py`, `recalc.py`, `requirements.txt` and this README are in place.
**`build_costing.py`, `build_roi.py` and `build.py` are not written yet** —
recreating the costing tabs exactly (same formulas, same totals) needs the
real formula structure from the existing reference workbook: which margin
convention each cost category uses, which line items scale by `FLEET_QTY`,
which of `INSTALL_RATE_PER_DAY`/`INSTALL_MONTHLY` applies, and the exact
split between what's in "Total First-Year Cost" vs "Grand Total". Share
the reference `.xlsx` (a file path Claude can read) to get those three
files filled in for real, rather than guessed.

## Project structure

```
inputs.py           -- every manual figure, as named constants
build_costing.py     -- (pending) builds the costing tabs
build_roi.py          -- (pending) builds the ROI tabs, imports totals from costing
build.py              -- entry point: runs both, saves, recalculates
recalc.py              -- LibreOffice headless recalculation, fails loudly on formula errors
tests/test_totals.py   -- regression check against the known totals
```

## Setup

```bash
cd iot-costing-roi
python -m venv .venv
.venv\Scripts\activate       # Windows
pip install -r requirements.txt
```

`recalc.py` additionally needs a local [LibreOffice](https://www.libreoffice.org/download/)
install (the `soffice` binary) — it was not installed in the environment
this repo was scaffolded in, so that script's invocation is written to the
standard, documented pattern but has not been run end-to-end. Install
LibreOffice, then run `python recalc.py <path>` once to confirm it works
on your machine before relying on it from `build.py`.

## Editing inputs and re-running

1. Open `inputs.py`. Every figure is a named constant with a source
   comment. Change a number, save.
2. Anything marked `NEEDS INPUT FROM SATHISHKUMAR` is a placeholder —
   do not fill it with an estimate; get the real figure first, since
   nothing downstream should ever be a guess.
3. Run:
   ```bash
   python build.py
   ```
   This writes the workbook, then recalculates it via LibreOffice headless
   and fails loudly (non-zero exit, printed cell list) if any formula
   errors are found.
4. Run the regression check:
   ```bash
   pytest tests/test_totals.py
   ```
   This loads the recalculated workbook with `data_only=True` and asserts
   Total First-Year Cost, Grand Total, and the Overall Summary TOTAL row
   still equal the known figures in `inputs.py`. If a change to `inputs.py`
   breaks this, the workbook's math changed — confirm that was intended
   before shipping it.

## Formatting conventions (once build_costing.py/build_roi.py exist)

- Arial font throughout, ₹ currency format, `0.0%` for margins.
- **Blue** = manual input, **black** = formula, **green** = cross-sheet link.
- Every cell that's a computed result is a formula referencing an Inputs-tab
  cell — never a literal number. Never hardcode a computed result anywhere.
- Every assumption gets a source comment: "given by Sathishkumar" or
  "NEEDS INPUT".
