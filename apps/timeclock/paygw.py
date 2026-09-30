"""
PAYG withholding: what an Australian employer takes out of a pay, worked out
the way the ATO tells payroll software to.

Everything here is copied from the ATO's published schedules, not derived:

- Schedule 1 (NAT 1004), "Statement of formulas for calculating amounts to
  be withheld", for payments from 1 July 2026 — scales 1, 2, 3 and 4.
- Schedule 8 (NAT 3539), the study and training support loans component
  (HELP, VSL, SSL, AASL), for payments from 1 July 2026.
- Schedule 15, the tax table for working holiday makers (417 and 462
  visas), for payments from 1 July 2026.

The method, from Schedule 1: turn the pay into weekly earnings (whole
dollars plus 99 cents — a fortnight halved, a month times 3 over 13), find
the band, withhold y = ax − b rounded to the nearest dollar, and scale that
weekly dollar figure back up to the pay period. apps/timeclock/test_paygw.py
checks every row of the ATO's own sample data against it.

What is left out, on purpose: Medicare levy exemptions and family
adjustments (scales 5 and 6, the Medicare levy variation declaration), tax
offsets claimed on a withholding declaration, and the extra withholding
some ask for in a year of 53 weekly pays. Each is a form most people never
fill in; anyone who did can still type their own percentage off a payslip.

The coefficients change every 1 July. Add the new year to `YEARS` when the
ATO publishes it (June) — a date after the last year here uses that year.
"""

from datetime import date
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal

D = Decimal

WEEK = "WEEK"
FORTNIGHT = "FORTNIGHT"
MONTH = "MONTH"

# What someone told this employer on their TFN declaration.
TFT = "TFT"            # resident, claiming the tax-free threshold — scale 2
NO_TFT = "NO_TFT"      # resident, not claiming it (a second job) — scale 1
FOREIGN = "FOREIGN"    # foreign resident — scale 3
WHM = "WHM"            # working holiday maker, 417 or 462 — Schedule 15
NO_TFN = "NO_TFN"      # no TFN given — scale 4


def _bands(*rows):
    """(weekly earnings less than, a, b) — None for the open top band."""
    return [(None if top is None else D(top), D(a), D(b)) for top, a, b in rows]


# Keyed by the 1 July each set took effect.
YEARS = {
    date(2026, 7, 1): {
        "scales": {
            NO_TFT: _bands(
                (188, "0.1500", "0.1500"),
                (371, "0.2084", "11.0185"),
                (515, "0.1790", "0.1066"),
                (932, "0.3227", "74.1674"),
                (2246, "0.3200", "71.6508"),
                (3303, "0.3900", "228.8816"),
                (None, "0.4700", "493.1893"),
            ),
            TFT: _bands(
                (362, "0", "0"),
                (538, "0.1500", "54.3462"),
                (673, "0.2500", "108.2135"),
                (721, "0.1700", "54.3473"),
                (865, "0.1790", "60.8377"),
                (1282, "0.3227", "185.1935"),
                (2596, "0.3200", "181.7319"),
                (3653, "0.3900", "363.4627"),
                (None, "0.4700", "655.7704"),
            ),
            FOREIGN: _bands(
                (2596, "0.3000", "0.3000"),
                (3653, "0.3700", "181.7308"),
                (None, "0.4500", "474.0385"),
            ),
        },
        # Schedule 8's component, added on top of the scale's amount. A
        # foreign resident uses the tax-free-threshold table.
        "study_loan": {
            TFT: _bands(
                (1337, "0", "0"),
                (2494, "0.15", "200.5615"),
                (3577, "0.17", "250.4527"),
                (None, "0.10", "0"),
            ),
            NO_TFT: _bands(
                (987, "0", "0"),
                (2144, "0.15", "148.0615"),
                (2727, "0.17", "190.9527"),
                (None, "0.10", "0"),
            ),
        },
        # Scale 4, a resident with no TFN: a flat rate, cents ignored.
        "no_tfn": D("0.47"),
        # Schedule 15: the rate is set by what this employer has already
        # paid them this financial year, before this pay.
        "whm": [
            (D(45000), D("0.15")),
            (D(135000), D("0.30")),
            (D(190000), D("0.37")),
            (None, D("0.45")),
        ],
    },
}


def year_for(day=None):
    """The coefficients in force on `day` (the earliest set before them)."""
    starts = sorted(YEARS)
    day = day or date.today()
    chosen = starts[0]
    for start in starts:
        if start <= day:
            chosen = start
    return YEARS[chosen]


def financial_year_start(day):
    """1 July on or before `day`."""
    return date(day.year if day.month >= 7 else day.year - 1, 7, 1)


def _whole(amount):
    return amount.to_integral_value(rounding=ROUND_FLOOR)


def _nearest(amount):
    """To the nearest dollar, 50 cents up, with no rounding to cents first."""
    return amount.to_integral_value(rounding=ROUND_HALF_UP)


def weekly_earnings(gross, period):
    """
    x in the formulas: the pay's weekly equivalent, whole dollars plus 99
    cents. A month ending in 33 cents gets a cent added first, as the
    schedule says, so a third of a dollar does not round the wrong way.
    """
    gross = D(str(gross)).quantize(D("0.01"))
    if period == FORTNIGHT:
        weekly = gross / 2
    elif period == MONTH:
        if gross % 1 == D("0.33"):
            gross += D("0.01")
        weekly = gross * 3 / 13
    else:
        weekly = gross
    return _whole(weekly) + D("0.99")


def _weekly_amount(x, bands):
    for top, a, b in bands:
        if top is None or x < top:
            return max(_nearest(a * x - b), D(0))
    return D(0)


def _to_period(weekly, period):
    if period == FORTNIGHT:
        return weekly * 2
    if period == MONTH:
        return _nearest(weekly * 13 / 3)
    return weekly


def withhold(gross, period, scale, *, study_loan=False, paid_this_year=0, on=None):
    """
    Whole dollars withheld from one pay of `gross` covering one `period`.

    `scale` is one of TFT, NO_TFT, FOREIGN, WHM, NO_TFN. `study_loan` adds
    Schedule 8's component (not for WHM or no TFN, which the schedules
    leave it out of). `paid_this_year` is only read for a working holiday
    maker, whose rate steps up with what this employer has paid them since
    1 July. `on` picks the year's coefficients.
    """
    gross = D(str(gross))
    if gross <= 0:
        return 0
    year = year_for(on)

    if scale == NO_TFN:
        return int(_whole(_whole(gross) * year["no_tfn"]))

    if scale == WHM:
        prior = D(str(paid_this_year))
        rate = next(r for top, r in year["whm"] if top is None or prior <= top)
        amount = rate * _whole(gross)
        # At the top rate the schedule ignores cents rather than rounding.
        return int(_whole(amount) if rate == year["whm"][-1][1] else _nearest(amount))

    bands = year["scales"].get(scale)
    if bands is None:
        raise ValueError(f"unknown withholding scale {scale!r}")

    x = weekly_earnings(gross, period)
    total = _to_period(_weekly_amount(x, bands), period)
    if study_loan:
        component = year["study_loan"][NO_TFT if scale == NO_TFT else TFT]
        total += _to_period(_weekly_amount(x, component), period)
    return int(total)
