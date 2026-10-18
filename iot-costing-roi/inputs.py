"""
inputs.py — every manual figure in the ThingsAlive IoT Fleet Logger
costing + ROI workbook, as named constants. Nothing else lives here:
no formulas, no derived values — build_costing.py / build_roi.py compute
everything else as live Excel formulas that reference cells built from
these constants.

Each constant is commented with its source. "given by Sathishkumar" means
exactly that — supplied directly, not estimated. Anything not yet known
is left as a commented-out placeholder further down — do not fill those
with an estimate; get the real figure first.
"""

# ── Fleet ──────────────────────────────────────────────────────
FLEET_QTY = 218  # given by Sathishkumar

# ── IoT Logger ───────────────────────────────────────────────────
IOT_LOGGER_COST = 8755      # given by Sathishkumar
IOT_LOGGER_MARGIN = 1.40    # given by Sathishkumar

# ── Firmware / App / SAP development (one-time) ─────────────────
FIRMWARE_APP_COST = 1070356.32  # given by Sathishkumar
SAP_COST = 593572.80            # given by Sathishkumar
DEV_MARGIN = 0.80                # given by Sathishkumar

# ── Maintenance ──────────────────────────────────────────────────
MAINTENANCE_COST = 800000     # given by Sathishkumar
MAINTENANCE_MARGIN = 1.10     # given by Sathishkumar

# ── QR Device ─────────────────────────────────────────────────────
QR_DEVICE_COST = 26000  # given by Sathishkumar
QR_MARGIN = 0.60         # given by Sathishkumar

# ── SaaS (per unit, monthly) ───────────────────────────────────────
SAAS_PLATFORM = 550   # given by Sathishkumar
SAAS_SMS = 150         # given by Sathishkumar
SAAS_SIM = 100         # given by Sathishkumar
SAAS_MARGIN = 0.70     # given by Sathishkumar

# ── Sensors ────────────────────────────────────────────────────────
FUEL_SENSOR_COST = 7350        # given by Sathishkumar
FUEL_SENSOR_MARGIN = 1.00      # given by Sathishkumar

TEMP_SENSOR_COST = 5050        # given by Sathishkumar
TEMP_SENSOR_MARGIN = 0.65      # given by Sathishkumar

PRESSURE_SENSOR_COST = 2850    # given by Sathishkumar
PRESSURE_SENSOR_MARGIN = 0.70  # given by Sathishkumar

HYDRAULIC_SENSOR_COST = 5050   # given by Sathishkumar
HYDRAULIC_SENSOR_MARGIN = 0.80 # given by Sathishkumar

# ── Installation ───────────────────────────────────────────────────
INSTALL_RATE_PER_DAY = 15000  # given by Sathishkumar
INSTALL_MONTHLY = 360000      # given by Sathishkumar

# ── Quantity/allocation assumptions — genuinely unknown, NOT fabricated ──
# Bare cost of just the IoT Logger + 4 sensors x FLEET_QTY already exceeds
# TOTAL_FIRST_YEAR_COST (see README's "Status" section for the arithmetic),
# so not every sensor goes on every vehicle. Real per-category quantities
# are required to make the workbook reconcile — until they're supplied,
# each defaults to FLEET_QTY (the simplest placeholder) and the
# corresponding Excel cell is yellow-highlighted "NEEDS INPUT FROM
# SATHISHKUMAR" rather than silently trusted.
FUEL_SENSOR_QTY = FLEET_QTY        # NEEDS INPUT — how many vehicles actually get a fuel sensor
TEMP_SENSOR_QTY = FLEET_QTY        # NEEDS INPUT
PRESSURE_SENSOR_QTY = FLEET_QTY    # NEEDS INPUT
HYDRAULIC_SENSOR_QTY = FLEET_QTY   # NEEDS INPUT
QR_DEVICE_QTY = 1                  # NEEDS INPUT — per-vehicle, per-site, or a fixed count?

# Install: which of INSTALL_RATE_PER_DAY / INSTALL_MONTHLY applies, and
# over how many days/months, is not stated — INSTALL_DAYS defaults to 0
# (install cost computes to 0 until this is filled in) rather than
# guessing a duration.
INSTALL_DAYS = 0     # NEEDS INPUT — number of install-days at INSTALL_RATE_PER_DAY
INSTALL_MONTHS = 0   # NEEDS INPUT — number of months at INSTALL_MONTHLY (if that method applies instead)

# SaaS is billed monthly — 12 months is a calendar fact for "first year",
# not a business assumption, so this one constant is not a placeholder.
SAAS_MONTHS_PER_YEAR = 12

# Multi-year horizon behind GRAND_TOTAL (~2.54x TOTAL_FIRST_YEAR_COST) —
# not stated which years' recurring costs (SaaS, maintenance) it includes.
# Defaults to 1 (Grand Total = First-Year Cost) until the real horizon is
# confirmed — do not assume 3yr/5yr without being told.
PROJECT_DURATION_YEARS = 1  # NEEDS INPUT

# ── Known reference totals (regression targets — see tests/test_totals.py) ──
# NEEDS INPUT: confirmed against the real workbook, not yet reproduced —
# build_costing.py is not wired to these until the source file/formula
# structure is confirmed (margin-application convention, which lines scale
# by FLEET_QTY, INSTALL_RATE_PER_DAY vs INSTALL_MONTHLY, and the First-Year
# vs Grand-Total split). See README.md.
TOTAL_FIRST_YEAR_COST = 5665319.12  # given by Sathishkumar
GRAND_TOTAL = 14410719.12            # given by Sathishkumar

# ── ROI additional benefit category — fill in once decided ──────────
# NEEDS INPUT FROM SATHISHKUMAR — do not estimate:
# ADDITIONAL_BENEFIT_CATEGORY = "__________"
# ADDITIONAL_BENEFIT_DRIVER_DEVICE = "__________"  # which sensor/device causes it
# ADDITIONAL_BENEFIT_VALUE = None  # exact figure to be provided — do not estimate
