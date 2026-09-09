"""
The month statement — a PDF of one month, to hold next to the money.

A payment arrives as a single line on a bank feed: a date and an amount. This
is the other side of it. One month of your own record, laid out so the figure
on the screen and the figure in your account can be checked against each
other line by line: what turned up, what it said it covered, and every shift
behind it.

Nothing here is calculated fresh. The hours come from the timesheet and the
payment lines from what you marked received, so a statement is a photograph
of your own records on the day you took it — which is exactly what makes it
worth keeping after the hours have been cleared and started again.

Layout lives in this module and the figures come in already worked out, so
the view stays a view and nothing about pay is decided twice.
"""

import colorsys
from datetime import timedelta
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# The app's own palette, so a printed page and the screen it came from are
# recognisably the same document.
INK = colors.HexColor("#0f172a")
INK_2 = colors.HexColor("#475569")
MUTED = colors.HexColor("#64748b")
LINE = colors.HexColor("#e8ebf0")
LINE_STRONG = colors.HexColor("#d4dae2")
BRAND = colors.HexColor("#059669")

PAGE = A4
MARGIN = 16 * mm

# Matches the CSS the workplace colours are drawn with: hsl(<hue> 62% 50%).
COLOR_S, COLOR_L = 0.62, 0.50


def hue_color(hue):
    """One workplace hue as a reportlab colour, or grey for no workplace."""
    if hue is None:
        return colors.HexColor("#8b9099")
    red, green, blue = colorsys.hls_to_rgb(hue / 360.0, COLOR_L, COLOR_S)
    return colors.Color(red, green, blue)


def hm(worked):
    """A timedelta as "5h 19m" — the same shape the screens use."""
    total = int(worked.total_seconds())
    hours, minutes = total // 3600, (total % 3600) // 60
    if hours and minutes:
        return f"{hours}h {minutes}m"
    return f"{hours}h" if hours else f"{minutes}m"


def money(amount):
    return "—" if amount is None else f"${amount:,.2f}"


# ---------------------------------------------------------------------------
#  Text styles
# ---------------------------------------------------------------------------

def _style(name, **kwargs):
    base = {
        "fontName": "Helvetica",
        "fontSize": 9,
        "leading": 12,
        "textColor": INK,
    }
    return ParagraphStyle(name, **{**base, **kwargs})


TITLE = _style("title", fontName="Helvetica-Bold", fontSize=19, leading=23, spaceAfter=2)
SUBTITLE = _style("subtitle", fontSize=10.5, leading=14, textColor=MUTED)
SECTION = _style(
    "section", fontName="Helvetica-Bold", fontSize=8, leading=11,
    textColor=MUTED, spaceBefore=0, spaceAfter=5,
)
BODY = _style("body")
NOTE = _style("note", fontSize=8, leading=11.5, textColor=MUTED)


def _section(title):
    # Small caps by hand: reportlab's base fonts have no small-cap variant and
    # the label is short enough that upper-casing it costs nothing.
    return Paragraph(title.upper(), SECTION)


# ---------------------------------------------------------------------------
#  Tables
# ---------------------------------------------------------------------------

# One look for every table on the page: a hairline under the head, a hairline
# between rows, no outer box and no fills. The same restraint the app's cards
# use — the alignment does the work a grid would otherwise have to.
def _table(rows, widths, aligns, head_align=None, extra=None):
    style = [
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.5),
        ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 9),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, LINE_STRONG),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]
    for column, align in enumerate(aligns):
        style.append(("ALIGN", (column, 0), (column, -1), align))
    for column, align in enumerate(head_align or aligns):
        style.append(("ALIGN", (column, 0), (column, 0), align))

    table = Table(rows, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle(style + (extra or [])))
    return table


def _total_row(row_index, columns):
    """A summed line: no rule above it, just weight and a little air."""
    return [
        ("FONT", (0, row_index), (columns - 1, row_index), "Helvetica-Bold", 9),
        ("TEXTCOLOR", (0, row_index), (columns - 1, row_index), INK),
        ("LINEABOVE", (0, row_index), (columns - 1, row_index), 0.6, LINE_STRONG),
        ("TOPPADDING", (0, row_index), (columns - 1, row_index), 7),
    ]


# ---------------------------------------------------------------------------
#  The document
# ---------------------------------------------------------------------------

def build(statement):
    """
    Render a prepared statement to PDF bytes.

    `statement` is the dict the view assembles: who it is for, which month and
    which job, the payments that landed, the shifts behind them and the totals
    of both. Everything here is presentation.
    """
    buffer = BytesIO()
    width = PAGE[0] - 2 * MARGIN

    doc = SimpleDocTemplate(
        buffer,
        pagesize=PAGE,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=18 * mm,
        title=statement["filename"].removesuffix(".pdf"),
        author="MyWork",
        subject=f"Hours and payments · {statement['month_label']}",
    )

    story = [
        Paragraph(statement["month_label"], TITLE),
        Paragraph(statement["subtitle"], SUBTITLE),
        Spacer(1, 14),
    ]

    story += _received(statement, width)
    story += _worked(statement, width)
    story += _by_workplace(statement, width)

    story += [
        Spacer(1, 16),
        Paragraph(statement["footnote"], NOTE),
    ]

    doc.build(story, onFirstPage=_furniture, onLaterPages=_furniture)
    return buffer.getvalue()


def _received(statement, width):
    """What arrived this month — the half you tick off against a bank feed."""
    payments = statement["payments"]
    if not payments:
        return [
            _section("Payments received"),
            Paragraph(
                "None recorded this month. Marking a payment received on the "
                "Pay screen lists it here.",
                NOTE,
            ),
            Spacer(1, 16),
        ]

    rows = [["Received", "Workplace", "Covers", "Hours", "Amount"]]
    tints = []
    for index, payment in enumerate(payments, start=1):
        rows.append([
            payment["received"],
            payment["workplace"],
            payment["covers"],
            payment["hours"],
            money(payment["amount"]),
        ])
        tints.append(
            ("TEXTCOLOR", (1, index), (1, index), hue_color(payment["hue"]))
        )

    rows.append(["", "", "Total received", statement["received_hours"],
                 money(statement["received_amount"])])

    widths = [width * w for w in (0.19, 0.26, 0.27, 0.12, 0.16)]
    aligns = ["LEFT", "LEFT", "LEFT", "RIGHT", "RIGHT"]
    extra = tints + _total_row(len(rows) - 1, 5) + [
        ("ALIGN", (2, len(rows) - 1), (2, len(rows) - 1), "RIGHT"),
        ("TEXTCOLOR", (2, len(rows) - 1), (2, len(rows) - 1), MUTED),
        ("FONT", (2, len(rows) - 1), (2, len(rows) - 1), "Helvetica", 8),
    ]

    return [
        _section("Payments received"),
        _table(rows, widths, aligns, extra=extra),
        Spacer(1, 18),
    ]


def _worked(statement, width):
    """Every shift behind those payments, in the order they happened."""
    shifts = statement["shifts"]
    if not shifts:
        return [
            _section("Hours worked"),
            Paragraph("No shifts recorded in this month.", NOTE),
            Spacer(1, 16),
        ]

    rows = [["Date", "Workplace", "Start", "Finish", "Break", "Hours", "Paid"]]
    tints = []
    for index, shift in enumerate(shifts, start=1):
        rows.append([
            shift["date"],
            shift["workplace"],
            shift["start"],
            shift["finish"],
            shift["break"],
            shift["hours"],
            shift["paid"],
        ])
        tints.append(("TEXTCOLOR", (1, index), (1, index), hue_color(shift["hue"])))
        if shift["paid"] == "—":
            tints.append(("TEXTCOLOR", (6, index), (6, index), MUTED))

    rows.append(["", "", "", "", "Total", statement["worked_hours"], ""])

    widths = [width * w for w in (0.16, 0.24, 0.13, 0.13, 0.11, 0.12, 0.11)]
    aligns = ["LEFT", "LEFT", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "RIGHT"]
    extra = tints + _total_row(len(rows) - 1, 7) + [
        ("TEXTCOLOR", (4, len(rows) - 1), (4, len(rows) - 1), MUTED),
        ("FONT", (4, len(rows) - 1), (4, len(rows) - 1), "Helvetica", 8),
    ]

    return [
        _section("Hours worked"),
        _table(rows, widths, aligns, extra=extra),
        Spacer(1, 18),
    ]


def _by_workplace(statement, width):
    """
    What the month came to at each job, priced by that job's own rate.

    Never one blended figure: two jobs on two rates and two withholding
    percentages add up, and averaging them would be wrong at both.
    """
    totals = statement["totals"]
    if not totals:
        return []

    rows = [["Workplace", "Hours", "Gross", "Tax withheld", "Take-home"]]
    tints = []
    for index, row in enumerate(totals, start=1):
        rows.append([
            row["workplace"],
            row["hours"],
            money(row["gross"]),
            money(row["tax"]),
            money(row["net"]),
        ])
        tints.append(("TEXTCOLOR", (0, index), (0, index), hue_color(row["hue"])))

    widths = [width * w for w in (0.30, 0.14, 0.18, 0.19, 0.19)]
    aligns = ["LEFT", "RIGHT", "RIGHT", "RIGHT", "RIGHT"]

    story = [
        _section("What the month came to"),
        _table(rows, widths, aligns, extra=tints),
    ]
    if statement["estimated"]:
        words = (
            "Pay is worked out from the hourly rate and withholding you saved "
            "for each job, so treat it as an estimate and check it against the "
            "payslip."
        )
        if statement["before_tax"]:
            # A dash rather than $0.00: nothing has been said about what this
            # job withholds, which is not the same as it withholding nothing.
            words += (
                " A dash means no withholding percentage is saved for that job "
                "— its gross is all that can honestly be shown."
            )
        story += [Spacer(1, 6), Paragraph(words, NOTE)]
    return story + [Spacer(1, 4)]


def _furniture(canvas, doc):
    """A rule and a name at the top, a page number at the foot."""
    canvas.saveState()

    top = PAGE[1] - MARGIN + 6 * mm
    canvas.setFont("Helvetica-Bold", 8)
    canvas.setFillColor(BRAND)
    canvas.drawString(MARGIN, top, "MyWork")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN, top - 3 * mm, PAGE[0] - MARGIN, top - 3 * mm)

    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(PAGE[0] - MARGIN, 12 * mm, f"Page {doc.page}")

    canvas.restoreState()
