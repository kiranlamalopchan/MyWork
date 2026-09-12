"""
Reads a payslip so the workplace form can be filled from it.

The three numbers the workplace form wants — an hourly rate, the share of
pay withheld as tax, and how often the job pays — are all printed on every
payslip, and copying them off one into three boxes is exactly the kind of
sum that gets done wrong (tax withheld ÷ gross × 100, on a phone, from a
PDF). So the form takes the payslip instead: the text is lifted off it,
the figures are found by their labels, and the boxes are filled for the
user to check before saving.

Two kinds of file: a PDF, which is what most payroll systems send and which
carries its text (pypdf); or a photo or screenshot of one, which is read
with Tesseract like the picking lists in the PLU app. A scanned PDF — a
picture inside a PDF — has no text to lift, and the user is told to send
the picture instead.

Every figure is best-effort and says so: the result carries a `read` list
of what was found and where the number came from, which the form shows
beside the boxes it filled. Nothing here is saved; the form still has to be
sent, and the user still sees every value first.
"""

import io
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from .models import MAX_MONTH_START_DAY, PayCycle, fortnight_started_last_week

MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 6

# What a photo has to be scaled up to before Tesseract reads small print
# reliably — the same figure the PLU app arrived at for picking lists.
OCR_WIDTH = 1800

MONEY = r"-?\$?\s*\(?-?\$?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\)?"
NUMBER = r"-?\d+(?:,\d{3})*(?:\.\d+)?"
DATE = (
    r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})"
    r"|(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{2,4})"
    r"|([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})"
    r"|(\d{4})-(\d{2})-(\d{2})"
)
MONTHS = {
    m: i + 1 for i, names in enumerate([
        ("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"),
        ("may",), ("jun", "june"), ("jul", "july"), ("aug", "august"),
        ("sep", "sept", "september"), ("oct", "october"), ("nov", "november"),
        ("dec", "december"),
    ]) for m in names
}

# Lines that are the year's running total, not this pay's. A figure on one
# of these is the wrong figure by however many pays have been.
YTD = re.compile(r"\b(ytd|y\.t\.d|year\s*to\s*date|this\s+year|fy\s*\d)", re.I)

GROSS = re.compile(r"\b(total\s+)?gross\b(?!\s*(?:ytd|hours|hrs))", re.I)
TAX = re.compile(
    r"\b(payg|pay\s*as\s*you\s*go|tax\s*withheld|withholding|income\s*tax|tax)\b",
    re.I,
)
NOT_TAX = re.compile(r"\b(taxable|before\s*tax|after\s*tax|pre[\s-]*tax|post[\s-]*tax|tax\s*free|tax-free|tax\s*file|tfn)\b", re.I)
NET = re.compile(r"\b(net|take[\s-]*home|nett)\b", re.I)
RATE = re.compile(r"\b(hourly\s*rate|base\s*rate|rate\s*of\s*pay|pay\s*rate|rate)\b", re.I)
ORDINARY = re.compile(r"\b(ordinary|base|normal|standard|regular|hourly|casual|permanent|part[\s-]*time|full[\s-]*time)\b", re.I)
HOURS_TOTAL = re.compile(r"\b(total\s+hours|hours\s+worked|hours\s+paid|hrs\s+worked|total\s+hrs)\b", re.I)
PERIOD = re.compile(r"\b(pay\s*period|period\s*(?:ending|end|start|from|to)?|period)\b|\bfrom\b.*\bto\b|\bweek\s*ending\b|\bfortnight\s*ending\b", re.I)
EMPLOYER = re.compile(r"\b(employer|company|business|trading\s*as|pay(?:ing)?\s*entity)\b\s*[:\-]?\s*(.+)", re.I)
NOT_EMPLOYER = re.compile(r"\b(pay\s*slip|payslip|pay\s*advice|payment\s*summary|remittance|statement|employee|abn|acn|tfn)\b", re.I)


class Unreadable(Exception):
    """The file could not be turned into words — the message is for the user."""


@dataclass
class Payslip:
    """What the payslip said, and what the workplace form should be told."""

    employer: str = ""
    gross: Decimal | None = None
    tax: Decimal | None = None
    net: Decimal | None = None
    hours: Decimal | None = None
    rate: Decimal | None = None
    period_start: date | None = None
    period_end: date | None = None
    # ("Hourly rate", "$32.50", "from the ordinary hours line") — the
    # trail the form shows so a figure is never taken on trust.
    read: list = field(default_factory=list)
    notes: list = field(default_factory=list)

    # ---- what the form gets ---------------------------------------------

    @property
    def tax_rate(self):
        """Withheld ÷ gross × 100, the sum the form's own help text sets."""
        if not self.gross or self.tax is None:
            return None
        share = (self.tax / self.gross * 100).quantize(Decimal("0.01"), ROUND_HALF_UP)
        return share if 0 <= share <= 100 else None

    @property
    def days(self):
        if not (self.period_start and self.period_end):
            return None
        return (self.period_end - self.period_start).days + 1

    @property
    def pay_cycle(self):
        """The cycle, from how long the period was; None if it was neither."""
        days = self.days
        if days is None:
            return None
        if 6 <= days <= 8:
            return PayCycle.WEEK
        if 13 <= days <= 15:
            return PayCycle.FORTNIGHT
        if 27 <= days <= 32:
            return PayCycle.MONTH
        return None

    def fields(self, today=None):
        """
        The workplace form's boxes and what to put in them.

        Only what was actually read: a box the payslip said nothing about is
        left out, and the form keeps whatever it had. The fortnight is put
        the way the form asks for it — a weekday and this-week-or-last —
        worked back from the period's first day.
        """
        today = today or date.today()
        out = {}
        if self.employer:
            out["name"] = self.employer
        if self.rate is not None:
            out["hourly_rate"] = str(self.rate)
        if self.tax_rate is not None:
            out["tax_rate"] = str(self.tax_rate)
        cycle = self.pay_cycle
        if cycle:
            out["pay_cycle"] = cycle
            out["limit_period"] = cycle
            start = self.period_start
            if cycle == PayCycle.WEEK:
                out["week_starts_on"] = start.weekday()
            elif cycle == PayCycle.FORTNIGHT:
                out["fortnight_starts_on"] = start.weekday()
                out["fortnight_phase"] = "last" if fortnight_started_last_week(start, today) else "this"
            elif cycle == PayCycle.MONTH:
                out["month_starts_on"] = min(start.day, MAX_MONTH_START_DAY)
        return out

    def as_json(self, today=None):
        return {
            "fields": self.fields(today),
            "read": [{"label": label, "value": value, "how": how} for label, value, how in self.read],
            "notes": self.notes,
        }


# ---- getting the words off the file ----------------------------------------


def read_text(uploaded):
    """
    The text of an uploaded payslip — PDF or picture.

    Decides by the bytes rather than the name, since a phone's share sheet
    is careless with both. Raises Unreadable with something to tell the
    user when there are no words to be had.
    """
    if uploaded.size > MAX_BYTES:
        raise Unreadable("That file is too big — a payslip is a page or two, under 10 MB.")
    data = uploaded.read()
    if data[:5] == b"%PDF-":
        return _pdf_text(data)
    return _image_text(data)


def _pdf_text(data):
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [(page.extract_text() or "") for page in reader.pages[:MAX_PAGES]]
    except Exception:
        raise Unreadable("That PDF could not be opened. Try saving it again, or send a photo of it.")
    text = "\n".join(pages)
    if len(re.sub(r"\s", "", text)) < 40:
        raise Unreadable(
            "That PDF is a picture of a payslip with no text in it. "
            "Take a screenshot or a photo of it and send that instead."
        )
    return text


def _image_text(data):
    from PIL import Image, ImageOps

    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:
        raise Unreadable("Send a payslip as a PDF, or a photo or screenshot of one.")
    try:
        import pytesseract

        image = ImageOps.exif_transpose(image).convert("L")
        image = ImageOps.autocontrast(image)
        if image.width < OCR_WIDTH:
            scale = OCR_WIDTH / image.width
            image = image.resize((int(image.width * scale), int(image.height * scale)), Image.LANCZOS)
        text = pytesseract.image_to_string(image, config="--psm 6")
    except Exception:
        raise Unreadable("That picture could not be read. A PDF of the payslip reads best.")
    if len(re.sub(r"\s", "", text)) < 40:
        raise Unreadable("No words could be made out in that picture. Try a clearer, straighter one — or the PDF.")
    return text


# ---- finding the figures in the words --------------------------------------


def _money(text):
    """
    Every amount with cents on a line, in order, as positive Decimals.

    Hours are printed with cents too ("76.00"), so an amount that came with
    its dollar sign is put first: on a line that has both, the money is
    the one marked as money.
    """
    signed, bare = [], []
    for match in re.finditer(MONEY, text):
        whole, cents = match.group(1), match.group(2)
        amount = Decimal(whole.replace(",", "") + "." + cents)
        (signed if "$" in match.group(0) else bare).append(amount)
    return signed + bare


def _numbers(text):
    """Every number on a line, in order — hours and rates have no $ sign."""
    out = []
    for match in re.finditer(NUMBER, text):
        raw = match.group(0).replace(",", "").lstrip("-")
        try:
            out.append(Decimal(raw))
        except Exception:
            continue
    return out


def _date(match):
    g = match.groups()
    try:
        if g[0]:
            d, m, y = int(g[0]), int(g[1]), int(g[2])
        elif g[3]:
            d, m, y = int(g[3]), MONTHS.get(g[4].lower()), int(g[5])
        elif g[6]:
            d, m, y = int(g[7]), MONTHS.get(g[6].lower()), int(g[8])
        else:
            y, m, d = int(g[9]), int(g[10]), int(g[11])
        if not m:
            return None
        if y < 100:
            y += 2000
        return date(y, m, d)
    except (ValueError, TypeError):
        return None


def _dates(text):
    return [d for d in (_date(m) for m in re.finditer(DATE, text)) if d]


def _first_amount(line, label):
    """The first amount after the label — this pay's, before any YTD column."""
    tail = line[label.end():]
    amounts = _money(tail)
    if amounts:
        return amounts[0]
    # "1,234.00 Gross" — the figure before the word, on a right-labelled slip.
    amounts = _money(line[:label.start()])
    return amounts[-1] if amounts else None


def _plausible_pair(hours, rate, amount):
    """Whether hours × rate is this amount, near enough to be that line."""
    if not (0 < hours <= 400 and 5 <= rate <= 500 and amount > 0):
        return False
    expected = hours * rate
    return abs(expected - amount) <= max(Decimal("0.05"), expected * Decimal("0.01"))


def _triples(line):
    """(hours, rate, amount) sets on a line where the sum works out."""
    nums = _numbers(line)
    found = []
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            for k in range(len(nums)):
                if k in (i, j):
                    continue
                if _plausible_pair(nums[i], nums[j], nums[k]):
                    found.append((nums[i], nums[j], nums[k]))
    return found


def parse(text):
    """The figures on a payslip, from its text — see Payslip."""
    slip = Payslip()
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line]

    _find_totals(slip, lines)
    _find_rate(slip, lines)
    _find_period(slip, lines)
    _find_employer(slip, lines)
    _check(slip)
    return slip


def _find_totals(slip, lines):
    for line in lines:
        if YTD.search(line):
            continue
        if slip.gross is None:
            m = GROSS.search(line)
            if m:
                amount = _first_amount(line, m)
                if amount:
                    slip.gross = amount
                    slip.read.append(("Gross pay", f"${amount:,.2f}", f"“{line[:60]}”"))
        if slip.tax is None and not NOT_TAX.search(line):
            m = TAX.search(line)
            if m:
                amount = _first_amount(line, m)
                if amount:
                    slip.tax = amount
                    slip.read.append(("Tax withheld", f"${amount:,.2f}", f"“{line[:60]}”"))
        if slip.net is None:
            m = NET.search(line)
            if m:
                amount = _first_amount(line, m)
                if amount:
                    slip.net = amount
        if slip.hours is None:
            m = HOURS_TOTAL.search(line)
            if m:
                nums = _numbers(line[m.end():])
                if nums and 0 < nums[0] <= 400:
                    slip.hours = nums[0]


def _find_rate(slip, lines):
    """
    The hourly rate, from the line where hours × rate = amount.

    The ordinary-hours line is the one to trust: penalties and loadings are
    printed at their own rates. So a line naming ordinary time comes first,
    then any line where the sum works, taking the one for the most money —
    the ordinary hours are almost always the biggest line on the slip.
    """
    best = None
    for line in lines:
        if YTD.search(line):
            continue
        for hours, rate, amount in _triples(line):
            named = bool(ORDINARY.search(line))
            key = (named, amount)
            if best is None or key > best[0]:
                best = (key, hours, rate, amount, line)
    if best:
        _, hours, rate, amount, line = best
        slip.rate = rate.quantize(Decimal("0.01"))
        if slip.hours is None:
            slip.hours = hours
        slip.read.append(("Hourly rate", f"${slip.rate}", f"{hours:g} h × ${rate:g} = ${amount:,.2f} — “{line[:50]}”"))
        return

    # A slip that prints the rate on its own: "Hourly rate: $32.50".
    for line in lines:
        m = RATE.search(line)
        if not m or YTD.search(line):
            continue
        nums = [n for n in _numbers(line[m.end():]) if 5 <= n <= 500]
        if nums:
            slip.rate = nums[0].quantize(Decimal("0.01"))
            slip.read.append(("Hourly rate", f"${slip.rate}", f"“{line[:60]}”"))
            return

    # No rate printed, but hours and gross are: the rate is the one that
    # gets from one to the other. Said so, since loadings blur it.
    if slip.hours and slip.gross:
        slip.rate = (slip.gross / slip.hours).quantize(Decimal("0.01"), ROUND_HALF_UP)
        slip.read.append(("Hourly rate", f"${slip.rate}", f"gross ${slip.gross:,.2f} ÷ {slip.hours:g} h — an average, so check it"))


def _find_period(slip, lines):
    """
    The pay period: two dates on a line that calls itself one, else the
    first two dates on the slip that are a week, fortnight or month apart.
    """
    candidates = []
    for i, line in enumerate(lines):
        # The label and its dates are sometimes on neighbouring lines.
        window = " ".join(lines[i:i + 2])
        if PERIOD.search(line):
            dates = _dates(window)
            if len(dates) >= 2:
                candidates.append((dates[0], dates[1], line))
    for start, end, line in candidates:
        if 6 <= (end - start).days + 1 <= 32:
            slip.period_start, slip.period_end = start, end
            slip.read.append(("Pay period", f"{start:%-d %b} – {end:%-d %b %Y}", f"“{line[:60]}”"))
            return
    # A "week ending" or "period ending" slip prints one date, and a week is
    # the only cycle that needs one date to be sure of.
    for line in lines:
        m = re.search(r"\b(week|fortnight)\s*ending\b", line, re.I)
        if m:
            dates = _dates(line[m.end():])
            if dates:
                span = 7 if m.group(1).lower() == "week" else 14
                slip.period_end = dates[0]
                slip.period_start = dates[0] - timedelta(days=span - 1)
                slip.read.append(("Pay period", f"{slip.period_start:%-d %b} – {slip.period_end:%-d %b %Y}", f"“{line[:60]}”"))
                return
    dates = _dates("\n".join(lines))
    for a, b in zip(dates, dates[1:]):
        if 6 <= (b - a).days + 1 <= 32:
            slip.period_start, slip.period_end = a, b
            slip.read.append(("Pay period", f"{a:%-d %b} – {b:%-d %b %Y}", "two dates a pay apart"))
            return


def _find_employer(slip, lines):
    for line in lines:
        m = EMPLOYER.search(line)
        if m:
            name = _clean_name(m.group(2))
            if name:
                slip.employer = name
                slip.read.append(("Workplace", name, f"“{line[:60]}”"))
                return
    # Failing a label: the first line that reads as a name rather than a
    # heading, a number or a person — payslips open with the company.
    for line in lines[:6]:
        if NOT_EMPLOYER.search(line) or re.search(r"\d", line):
            continue
        name = _clean_name(line)
        if name and len(name.split()) <= 6:
            slip.employer = name
            slip.read.append(("Workplace", name, "the first line of the payslip"))
            return


def _clean_name(raw):
    name = re.sub(r"\b(abn|acn)\b.*$", "", raw, flags=re.I)
    name = re.sub(r"[|:]+.*$", "", name)
    name = re.sub(r"\s+", " ", name).strip(" -–,.")
    return name[:120] if 2 <= len(name) <= 120 else ""


def _check(slip):
    """Sanity: the numbers should agree with each other where they can."""
    if slip.gross is None and slip.tax is not None and slip.net:
        # A slip that prints taxable and net but never the word gross.
        slip.gross = slip.net + slip.tax
        slip.read.append(("Gross pay", f"${slip.gross:,.2f}", "net + tax, as no gross line was printed"))
    if slip.gross and slip.tax is not None and slip.tax > slip.gross:
        slip.notes.append("The tax found is more than the gross — one of them is probably the wrong figure.")
        slip.tax = None
    if slip.gross and slip.tax is not None and slip.net:
        if abs((slip.gross - slip.tax) - slip.net) > max(Decimal("1"), slip.gross * Decimal("0.05")):
            slip.notes.append("Gross − tax doesn't come to the net pay shown, so there may be other deductions — the tax % is still the withheld share.")
    if slip.gross and slip.tax is None:
        slip.notes.append("No tax line was found. If this job withholds tax, take it off the slip: tax ÷ gross × 100.")
    if slip.rate is None:
        slip.notes.append("No hourly rate could be worked out — type it in.")
    if slip.pay_cycle is None:
        slip.notes.append("The pay period wasn't clear, so how often this job pays is left as it was.")
