"""
Reading a payslip.

A payslip is the one document that settles an argument: it is the employer's
own statement of what they paid you and what they took out. MyWork can only
ever estimate those figures from an hourly rate; the slip knows them. So this
module's job is to get the numbers off the paper and into the app, where they
can be checked against the hours you actually recorded.

Two steps, and they are deliberately separate.

`text_from` gets words out of a file — straight out of a PDF where the payroll
system made one, and through OCR where all you have is a photo.

`parse` reads those words. It does not trust any single number it finds. A
payslip almost always prints two columns — this pay and year to date — and a
label like "Gross" sits on a line with both. So every candidate is collected,
and the one that gets believed is the combination where gross − tax actually
equals net. Arithmetic is a far better witness than column position, and it
is the same check a person does with their thumb on the page.

Nothing here decides anything on its own. What it produces is a filled-in
form for a person to confirm, because "exactly" is a promise only the person
holding the slip can keep.
"""

import re
from datetime import date
from decimal import Decimal, InvalidOperation

# A payslip is one page of dense small print. Read more than this and it is
# not a payslip.
MAX_TEXT = 200_000

# How close two money figures have to be to count as agreeing. Payroll systems
# round to the cent, and OCR occasionally loses one.
CENT = Decimal("0.02")


# ---------------------------------------------------------------------------
#  Getting words out of a file
# ---------------------------------------------------------------------------

class Unreadable(Exception):
    """The file arrived, but nothing legible came out of it."""


def text_from(upload):
    """
    The words on an uploaded payslip, and how they were got.

    Returns (text, how) where `how` is "pdf" for a PDF the payroll system
    wrote as text, or "photo" for anything read with OCR. The distinction is
    worth keeping: text lifted out of a PDF is exact, while text read off a
    photograph is a good guess, and the review screen says which you are
    looking at.
    """
    name = (getattr(upload, "name", "") or "").lower()
    upload.seek(0)

    if name.endswith(".pdf"):
        text = _from_pdf(upload)
        if _is_legible(text):
            return text[:MAX_TEXT], "pdf"
        # A scanned payslip is a picture that happens to live in a PDF. There
        # is nothing to lift out of it, so fall through to reading it.
        raise Unreadable(
            "That PDF has no text in it — it looks like a scan. A photo of "
            "the slip works better here."
        )

    return _from_image(upload)[:MAX_TEXT], "photo"


def _from_pdf(upload):
    try:
        from pypdf import PdfReader
    except ImportError:  # pragma: no cover - pypdf ships in requirements
        return ""

    try:
        reader = PdfReader(upload)
        return "\n".join(page.extract_text() or "" for page in reader.pages[:8])
    except Exception as exc:
        raise Unreadable("That PDF could not be opened.") from exc


def _from_image(upload):
    try:
        import pytesseract
        from PIL import Image, ImageOps
    except ImportError as exc:  # pragma: no cover - both ship in requirements
        raise Unreadable("Reading photos is not available on this server.") from exc

    try:
        image = Image.open(upload)
        image = ImageOps.exif_transpose(image).convert("L")
        image = ImageOps.autocontrast(image)
        # A payslip's print is small and a phone camera is far away. Tesseract
        # wants roughly 300dpi worth of pixels across a page to read a column
        # of figures without inventing digits.
        if image.width < 2000:
            scale = 2000 / image.width
            image = image.resize(
                (int(image.width * scale), int(image.height * scale)), Image.LANCZOS
            )
        # psm 6 — one uniform block. A payslip is a table, and telling
        # Tesseract to look for columns of its own makes it worse, not better.
        text = pytesseract.image_to_string(image, config="--psm 6")
    except Exception as exc:
        raise Unreadable(
            "That image could not be read. A straight-on photo in good light, "
            "close enough that the figures are sharp, reads best."
        ) from exc

    if not _is_legible(text):
        raise Unreadable(
            "No readable text came off that photo. Try again closer, or with "
            "the whole slip flat in the frame."
        )
    return text


def _is_legible(text):
    """Enough words and enough digits to be a payslip rather than noise."""
    if not text or len(text.strip()) < 40:
        return False
    return sum(character.isdigit() for character in text) >= 6


# ---------------------------------------------------------------------------
#  Reading the words
# ---------------------------------------------------------------------------

# 1,721.80 · 1721.80 · $33.25 · 51.78335 · (186.00) for a negative
NUMBER = re.compile(r"\(?-?\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\)?")

# What each figure is called, in the wordings payroll systems actually print.
# Ordered longest-intent first so "total gross" is not read as bare "gross".
LABELS = {
    "gross": r"(?:total\s+)?gross(?:\s+(?:pay|payment|earnings|wages|income|amount))?|taxable\s+(?:gross|earnings|income)",
    "tax": r"(?:payg|p\.?a\.?y\.?g\.?)(?:\s+with(?:holding|held))?|tax\s+with(?:holding|held)|with(?:holding|held)\s+tax|(?:income\s+)?tax(?:ation)?(?:\s+deducted)?|paye",
    "net": r"(?:total\s+)?ne?tt?(?:\s+(?:pay|payment|amount|earnings))?|take[\s-]?home|amount\s+(?:paid|banked)|bank(?:ed)?\s+amount",
    "super": r"super(?:annuation)?(?:\s+guarantee)?|sgc?\b|employer\s+contribution",
    "hours": r"(?:ordinary|normal|total|worked)\s+h(?:ou)?rs?|h(?:ou)?rs?\.?\s*(?:worked|paid)?\b|units|qty|quantity",
    "rate": r"(?:hourly\s+)?rate(?:\s+of\s+pay)?|per\s+hour|\$\s?/\s?h(?:r|our)?",
}

# Lines that carry a figure belonging to a different pay altogether.
YEAR_TO_DATE = re.compile(r"\by\.?t\.?d\.?\b|year[\s-]to[\s-]date|financial\s+year", re.I)

DATE_PATTERNS = (
    # 26/08/2026 · 26-08-26 · 26.08.2026
    (re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b"), "dmy"),
    # 2026-08-26
    (re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b"), "ymd"),
    # 26 August 2026 · 26 Aug 26
    (re.compile(r"\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{2,4})\b"), "dMy"),
    # August 26, 2026
    (re.compile(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})\b"), "Mdy"),
)

MONTHS = {
    m: n for n, name in enumerate(
        ("january", "february", "march", "april", "may", "june", "july",
         "august", "september", "october", "november", "december"), start=1
    )
    for m in (name, name[:3])
}

# Two different things a date on a payslip can be, and they are routinely
# printed on the same line as each other.
PERIOD_LINE = re.compile(
    r"pay\s*period|period\s*(?:ending|ended|end|start|from)?"
    r"|for\s+the\s+period|week\s+ending",
    re.I,
)
PAID_LINE = re.compile(r"pay(?:ment)?\s*(?:date|day)|date\s+paid", re.I)


def _money(raw):
    try:
        return Decimal(raw.replace(",", ""))
    except (InvalidOperation, AttributeError):
        return None


def _numbers_on(line):
    """Every number on a line, in the order printed."""
    found = []
    for match in NUMBER.finditer(line):
        value = _money(match.group(1))
        if value is not None:
            found.append(value)
    return found


def _candidates(lines):
    """
    Every number that could be each figure, best guess first.

    A payslip prints this pay beside year to date, so a label's line usually
    carries both. Both are kept — which is which is settled later, by whether
    the three of them add up.
    """
    found = {key: [] for key in LABELS}

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # "51.7834 hrs @ $33.2500" names both without labelling either.
        if (at_rate := re.search(r"@\s*\$?\s*(\d+(?:\.\d+)?)", stripped)):
            if (value := _money(at_rate.group(1))) is not None:
                if value not in found["rate"]:
                    found["rate"].append(value)
        # A "YTD" line is about a different pay entirely and never belongs to
        # this one, however plainly it is labelled.
        if YEAR_TO_DATE.search(stripped):
            continue

        for key, pattern in LABELS.items():
            if not re.search(rf"(?<![a-z]){pattern}", stripped, re.I):
                continue
            numbers = _numbers_on(stripped)
            if key == "hours":
                # "51.7834 hrs @ $33.25" — the hours are the number in front
                # of the word, not the first number on the line.
                spelled = re.findall(r"(\d+(?:\.\d+)?)\s*h(?:ou)?rs?\b", stripped, re.I)
                if spelled:
                    numbers = [_money(n) for n in spelled] + numbers
            if key == "rate":
                # "@ $33.25" is a rate wherever it appears.
                at_rate = re.findall(r"@\s*\$?\s*(\d+(?:\.\d+)?)", stripped)
                if at_rate:
                    numbers = [_money(n) for n in at_rate] + numbers
                # A rate line reads "Ordinary 51.78 33.25 1,721.80": the rate
                # is not the first number on it, but it is the only one that
                # looks like an hourly rate.
                numbers = [n for n in numbers if Decimal("5") <= n <= Decimal("400")]
            for number in numbers:
                if number not in found[key]:
                    found[key].append(number)

    return found


def _balance(found):
    """
    The reading of gross, tax and net where the arithmetic works.

    Every payslip in the country satisfies gross − tax = net. When one of the
    three has been picked out of the wrong column, that sum stops working, and
    trying the other candidates until it works again recovers the right one
    without knowing anything about the layout.

    Returns (gross, tax, net, balanced).
    """
    gross_all = found["gross"] or [None]
    tax_all = found["tax"] or [None]
    net_all = found["net"] or [None]

    # Every combination whose arithmetic works. There is usually more than
    # one, because a year-to-date column balances every bit as well as this
    # pay does — and it is always the larger of the two. So of the readings
    # that add up, the smallest gross is this payslip's own.
    works = [
        (gross, tax, net)
        for gross in gross_all
        for tax in tax_all
        for net in net_all
        if None not in (gross, tax, net) and abs(gross - tax - net) <= CENT
    ]
    if works:
        return (*min(works, key=lambda trio: trio[0]), True)

    # Two of the three are enough to work out the third, and a slip that
    # names only two is common — some print no net at all.
    gross, tax, net = gross_all[0], tax_all[0], net_all[0]
    if gross is not None and tax is not None and net is None:
        return gross, tax, gross - tax, True
    if gross is not None and net is not None and tax is None:
        return gross, gross - net, net, True
    if tax is not None and net is not None and gross is None:
        return tax + net, tax, net, True

    return gross, tax, net, False


def _dates(lines):
    """
    The period the slip covers, and the day it was paid.

    Only dates on a line that says what they are get used. A payslip is
    covered in dates — the employer's ABN registration, a superannuation fund
    address, the date it was printed — and picking one up because it looked
    like a date is how you end up filing August's pay under 1974.

    "Pay Period: 13/08 to 26/08    Payment Date: 26/08" is one line saying two
    things, so each label takes the dates that follow it rather than the line
    being handed whole to whichever label matched first.
    """
    covered, paid = [], []

    for line in lines:
        for label, segment in _labelled_parts(line):
            found = _dates_in(segment)
            if not found:
                continue
            (paid if label == "paid" else covered).extend(found)

    paid_on = paid[0] if paid else None
    dates = sorted(set(covered))

    if len(dates) >= 2:
        return dates[0], dates[-1], paid_on
    if len(dates) == 1:
        # "Period ending 26/08/2026" — one end, and the other is not stated.
        return None, dates[0], paid_on
    return None, None, paid_on


def _labelled_parts(line):
    """
    The line cut up at its date labels: (label, the text following it).

    Everything before the first label is dropped, because a date with nothing
    saying what it is has not told us anything.
    """
    marks = [(m.start(), "period") for m in PERIOD_LINE.finditer(line)]
    marks += [(m.start(), "paid") for m in PAID_LINE.finditer(line)]
    marks.sort()

    parts = []
    for index, (start, label) in enumerate(marks):
        stop = marks[index + 1][0] if index + 1 < len(marks) else len(line)
        parts.append((label, line[start:stop]))
    return parts


def _dates_in(line):
    found = []
    for pattern, order in DATE_PATTERNS:
        for match in pattern.finditer(line):
            parsed = _as_date(match.groups(), order)
            if parsed and parsed not in found:
                found.append(parsed)
    return found


def _as_date(parts, order):
    try:
        if order == "dmy":
            day, month, year = int(parts[0]), int(parts[1]), int(parts[2])
        elif order == "ymd":
            year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        elif order == "dMy":
            day, year = int(parts[0]), int(parts[2])
            month = MONTHS.get(parts[1].lower())
        else:
            day, year = int(parts[1]), int(parts[2])
            month = MONTHS.get(parts[0].lower())
        if not month:
            return None
        if year < 100:
            year += 2000
        return date(year, month, day)
    except (ValueError, TypeError):
        return None


def parse(text):
    """
    What a payslip's words say, as far as they can be trusted.

    Everything comes back as a suggestion. `balanced` says whether gross, tax
    and net agree with each other, which is the difference between "we read
    this" and "we read this and it adds up" — and it is the one thing worth
    showing a person before they confirm the figures.
    """
    lines = [line for line in (text or "").splitlines() if line.strip()]
    found = _candidates(lines)
    gross, tax, net, balanced = _balance(found)
    period_start, period_end, paid_on = _dates(lines)

    hours = next((h for h in found["hours"] if Decimal("0") < h <= Decimal("400")), None)
    rate = next(iter(found["rate"]), None)
    # A rate nobody printed can still be worked out, and a rate that does not
    # produce the gross is not this slip's rate.
    if rate is None and gross and hours:
        rate = (gross / hours).quantize(Decimal("0.01"))

    return {
        "gross": gross,
        "tax": tax,
        "net": net,
        "super": next(iter(found["super"]), None),
        "hours": hours,
        "rate": rate,
        "period_start": period_start,
        "period_end": period_end,
        "paid_on": paid_on,
        "balanced": balanced,
        # True when hours × rate comes to the gross, which is the other half
        # of checking a slip: the money agrees *and* the work agrees.
        "hours_check": (
            None if not (hours and rate and gross)
            else abs(hours * rate - gross) <= max(CENT, gross * Decimal("0.005"))
        ),
        "candidates": found,
    }


def withheld_percent(gross, tax):
    """
    What share of the gross was withheld, to two places.

    This is exactly what a workplace's tax rate field asks for, and taking it
    off a real payslip is the only way to get it right: the PAYG scales are
    progressive, change every year, and depend on what was claimed on a TFN
    declaration this app has never seen.
    """
    if not gross or gross <= 0 or tax is None:
        return None
    return (Decimal(tax) / Decimal(gross) * 100).quantize(Decimal("0.01"))
