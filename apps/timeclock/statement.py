"""
The statement — a PDF of a stretch of your record, laid out like a payslip.

A payment arrives as a single line on a bank feed: a date and an amount. This
is the other side of it. One period of your own record, laid out so the
figure on the screen and the figure in your account can be checked against
each other line by line: what turned up, what it said it covered, and every
shift behind it.

Nothing here is calculated fresh. The hours come from the timesheet and the
payment lines from what you marked received, so a statement is a photograph
of your own records on the day you took it — which is exactly what makes it
worth keeping after the hours have been cleared and started again.

Layout lives in this module and the figures come in already worked out, so
the view stays a view and nothing about pay is decided twice.

The page is built the way a payslip is: the mark and the name of who issued
it; who it is for and what it covers; the four figures that matter in a row
of tiles; then the detail underneath, for checking.
"""

import colorsys
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# The app's own palette, so a printed page and the screen it came from are
# recognisably the same document.
INK = colors.HexColor("#0f172a")
INK_2 = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748b")
LINE = colors.HexColor("#e8ebf0")
LINE_STRONG = colors.HexColor("#d4dae2")
BRAND = colors.HexColor("#059669")
BRAND_DEEP = colors.HexColor("#047857")
BRAND_LIGHT = colors.HexColor("#34d399")
BRAND_SOFT = colors.HexColor("#e7f6f0")
TILE = colors.HexColor("#f4f6f9")
WHITE = colors.white

PAGE = A4
MARGIN = 16 * mm
FRAME_PAD = 6      # SimpleDocTemplate's own frame padding
EDGE = MARGIN + FRAME_PAD   # where the flowables' left edge actually lands

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
#  The mark
# ---------------------------------------------------------------------------

def draw_mark(canvas, x, y, size):
    """
    The MyWork mark: the app icon, drawn rather than pasted.

    The same shapes static/img/icon.svg is made of — a rounded square with
    the green running light to deep across it, and the M as one stroke with
    round ends — scaled from the icon's 512 grid to `size`. Drawn with the
    canvas so it is crisp at any size and the PDF carries no image.
    """
    scale = size / 512.0
    canvas.saveState()
    canvas.translate(x, y)
    canvas.scale(scale, scale)

    box = canvas.beginPath()
    box.roundRect(0, 0, 512, 512, 120)
    canvas.clipPath(box, stroke=0, fill=0)
    canvas.linearGradient(0, 512, 512, 0, (BRAND_LIGHT, BRAND_DEEP), extend=True)

    canvas.setStrokeColor(WHITE)
    canvas.setLineWidth(44)
    canvas.setLineCap(1)
    canvas.setLineJoin(1)
    # The SVG's y runs down the page; the canvas's runs up.
    m = canvas.beginPath()
    m.moveTo(136, 512 - 358)
    m.lineTo(136, 512 - 178)
    m.lineTo(256, 512 - 284)
    m.lineTo(376, 512 - 178)
    m.lineTo(376, 512 - 358)
    canvas.drawPath(m, stroke=1, fill=0)
    canvas.restoreState()


class Mark(Flowable):
    """The mark as something a table cell can hold."""

    def __init__(self, size):
        super().__init__()
        self.size = size
        self.width = self.height = size

    def draw(self):
        draw_mark(self.canv, 0, 0, self.size)


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


WORDMARK = _style("wordmark", fontName="Helvetica-Bold", fontSize=17, leading=20, textColor=INK)
TAGLINE = _style("tagline", fontSize=8.5, leading=11, textColor=MUTED)
DOC_KIND = _style(
    "kind", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=BRAND,
    alignment=2,
)
DOC_TITLE = _style("doctitle", fontName="Helvetica-Bold", fontSize=17, leading=21, alignment=2)
DOC_META = _style("docmeta", fontSize=8.5, leading=12, textColor=MUTED, alignment=2)

LABEL = _style("label", fontName="Helvetica-Bold", fontSize=7, leading=10, textColor=MUTED)
VALUE = _style("value", fontSize=9.5, leading=13)
VALUE_STRONG = _style("valuestrong", fontName="Helvetica-Bold", fontSize=10.5, leading=14)

TILE_LABEL = _style("tilelabel", fontName="Helvetica-Bold", fontSize=7, leading=9, textColor=MUTED)
TILE_VALUE = _style("tilevalue", fontName="Helvetica-Bold", fontSize=15, leading=18)
TILE_SUB = _style("tilesub", fontSize=7.5, leading=10, textColor=MUTED)

SECTION = _style(
    "section", fontName="Helvetica-Bold", fontSize=8, leading=11,
    textColor=INK_2, spaceAfter=5,
)
NOTE = _style("note", fontSize=8, leading=11.5, textColor=MUTED)


def _section(title):
    # Small caps by hand: reportlab's base fonts have no small-cap variant and
    # the label is short enough that upper-casing it costs nothing.
    return Paragraph(title.upper(), SECTION)


def _labelled(label, value, strong=False):
    return [Paragraph(label.upper(), LABEL), Paragraph(value, VALUE_STRONG if strong else VALUE)]


# ---------------------------------------------------------------------------
#  Tables
# ---------------------------------------------------------------------------

# One look for every table on the page: a soft head band, a hairline between
# rows, no outer box. The same restraint the app's cards use — the alignment
# does the work a grid would otherwise have to.
def _table(rows, widths, aligns, extra=None):
    style = [
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.5),
        ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
        ("BACKGROUND", (0, 0), (-1, 0), TILE),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 9),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("ROUNDEDCORNERS", [4, 4, 0, 0]),
    ]
    for column, align in enumerate(aligns):
        style.append(("ALIGN", (column, 0), (column, -1), align))

    table = Table(rows, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle(style + (extra or [])))
    return table


def _total_row(row_index, columns):
    """A summed line: a rule above it, weight, and a little air."""
    return [
        ("FONT", (0, row_index), (columns - 1, row_index), "Helvetica-Bold", 9),
        ("TEXTCOLOR", (0, row_index), (columns - 1, row_index), INK),
        ("LINEABOVE", (0, row_index), (columns - 1, row_index), 0.8, LINE_STRONG),
        ("TOPPADDING", (0, row_index), (columns - 1, row_index), 7),
    ]


# ---------------------------------------------------------------------------
#  The document
# ---------------------------------------------------------------------------

def build(statement):
    """
    Render a prepared statement to PDF bytes.

    `statement` is the dict the view assembles: who it is for, which period
    and which job, the payments that landed, the shifts behind them and the
    totals of both. Everything here is presentation.
    """
    buffer = BytesIO()
    # The frame keeps 6pt of padding inside the margins; everything is cut
    # to the width inside that, so every block shares one left edge.
    width = PAGE[0] - 2 * MARGIN - 2 * FRAME_PAD

    doc = SimpleDocTemplate(
        buffer,
        pagesize=PAGE,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=20 * mm,
        title=statement["filename"].removesuffix(".pdf"),
        author="MyWork",
        subject=f"Hours and pay statement · {statement['period_label']}",
    )

    story = _masthead(statement, width)
    story += _parties(statement, width)
    story += _summary(statement, width)
    story += _by_workplace(statement, width)
    story += _received(statement, width)
    story += _worked(statement, width)
    story += [Spacer(1, 14), Paragraph(statement["footnote"], NOTE)]

    doc.build(story, onFirstPage=_furniture, onLaterPages=_furniture)
    return buffer.getvalue()


def _masthead(statement, width):
    """The mark and the name on the left; what this document is on the right."""
    left = Table(
        [[Mark(34), [Paragraph("MyWork", WORDMARK), Paragraph("Hours &amp; pay statement", TAGLINE)]]],
        colWidths=[42, width * 0.5 - 42],
    )
    left.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    right = [
        Paragraph("STATEMENT", DOC_KIND),
        Paragraph(statement["period_label"], DOC_TITLE),
        Paragraph(f"Ref {statement['reference']} · issued {statement['issued']}", DOC_META),
    ]
    head = Table([[left, right]], colWidths=[width * 0.5, width * 0.5])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, BRAND),
    ]))
    return [head, Spacer(1, 12)]


def _parties(statement, width):
    """Who it is for, and what it covers — the two blocks a payslip opens with."""
    person = statement["person"]
    left = [
        Paragraph("PREPARED FOR", LABEL),
        Paragraph(person["name"], VALUE_STRONG),
    ]
    for line in person["lines"]:
        left.append(Paragraph(line, VALUE))

    right = []
    for label, value in statement["details"]:
        right += _labelled(label, value)
        right.append(Spacer(1, 3))

    block = Table([[left, right]], colWidths=[width * 0.5, width * 0.5])
    block.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return [block, Spacer(1, 14)]


def _summary(statement, width):
    """
    The four figures, in a row of tiles: hours, gross, tax, take-home. What
    a payslip is read for, before anything underneath it is checked.
    """
    tiles = statement["summary"]
    cells = []
    for tile in tiles:
        cells.append([
            Paragraph(tile["label"].upper(), TILE_LABEL),
            Spacer(1, 2),
            Paragraph(tile["value"], TILE_VALUE),
            Paragraph(tile["sub"], TILE_SUB),
        ])
    gap = 6
    tile_w = (width - gap * (len(tiles) - 1)) / len(tiles)
    row, widths = [], []
    for index, cell in enumerate(cells):
        if index:
            row.append("")
            widths.append(gap)
        row.append(cell)
        widths.append(tile_w)

    table = Table([row], colWidths=widths)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("ROUNDEDCORNERS", [6, 6, 6, 6]),
    ]
    for index in range(len(tiles)):
        column = index * 2
        # The take-home tile is the one the eye goes to, so it wears the
        # brand; the others sit on the page's own grey.
        lead = tiles[index].get("lead")
        style.append(("BACKGROUND", (column, 0), (column, 0), BRAND_SOFT if lead else TILE))
    table.setStyle(TableStyle(style))
    return [table, Spacer(1, 16)]


def _by_workplace(statement, width):
    """
    What the period came to at each job, priced by that job's own rate.

    Never one blended figure: two jobs on two rates and two withholding
    percentages add up, and averaging them would be wrong at both.
    """
    totals = statement["totals"]
    if not totals:
        return []

    rows = [["Workplace", "Rate", "Hours", "Gross", "Tax withheld", "Take-home"]]
    tints = []
    for index, row in enumerate(totals, start=1):
        rows.append([
            row["workplace"],
            row["rate"],
            row["hours"],
            money(row["gross"]),
            money(row["tax"]),
            money(row["net"]),
        ])
        tints.append(("TEXTCOLOR", (0, index), (0, index), hue_color(row["hue"])))
        tints.append(("FONT", (0, index), (0, index), "Helvetica-Bold", 9))

    if len(totals) > 1:
        rows.append(["Total", "", statement["worked_hours"],
                     money(statement["gross_total"]), money(statement["tax_total"]),
                     money(statement["net_total"])])
        tints += _total_row(len(rows) - 1, 6)

    widths = [width * w for w in (0.28, 0.12, 0.13, 0.15, 0.16, 0.16)]
    aligns = ["LEFT", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "RIGHT"]

    story = [
        _section("Earnings by workplace"),
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
        story += [Spacer(1, 5), Paragraph(words, NOTE)]
    return [KeepTogether(story), Spacer(1, 16)]


def _received(statement, width):
    """What arrived in the period — the half you tick off against a bank feed."""
    payments = statement["payments"]
    if not payments:
        return [
            _section("Payments received"),
            Paragraph(
                "None recorded in this period. Marking a payment received on "
                "the Pay screen lists it here.",
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

    rows.append(["Total received", "", "", statement["received_hours"],
                 money(statement["received_amount"])])

    widths = [width * w for w in (0.19, 0.26, 0.27, 0.12, 0.16)]
    aligns = ["LEFT", "LEFT", "LEFT", "RIGHT", "RIGHT"]
    extra = tints + _total_row(len(rows) - 1, 5)

    return [
        _section("Payments received"),
        _table(rows, widths, aligns, extra=extra),
        Spacer(1, 16),
    ]


def _worked(statement, width):
    """Every shift behind those figures, in the order they happened."""
    shifts = statement["shifts"]
    if not shifts:
        return [
            _section("Hours worked"),
            Paragraph("No shifts recorded in this period.", NOTE),
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

    rows.append(["Total", "", "", "", "", statement["worked_hours"], ""])

    widths = [width * w for w in (0.16, 0.24, 0.13, 0.13, 0.11, 0.12, 0.11)]
    aligns = ["LEFT", "LEFT", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "RIGHT"]
    extra = tints + _total_row(len(rows) - 1, 7)

    return [
        _section("Hours worked"),
        _table(rows, widths, aligns, extra=extra),
    ]


def _furniture(canvas, doc):
    """The small mark and a rule at the top of every page; the page number at the foot."""
    canvas.saveState()

    top = PAGE[1] - MARGIN + 4 * mm
    draw_mark(canvas, EDGE, top - 1, 9)
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(EDGE + 12, top + 1, "MyWork")
    canvas.drawRightString(PAGE[0] - EDGE, top + 1, doc.title)

    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(EDGE, 14 * mm, PAGE[0] - EDGE, 14 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(EDGE, 9.5 * mm, "Generated by MyWork from your own timesheet")
    canvas.drawRightString(PAGE[0] - EDGE, 9.5 * mm, f"Page {doc.page}")

    canvas.restoreState()
