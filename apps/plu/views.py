# plu/views.py
import csv
import io
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from django.contrib import messages
from django.contrib.auth.decorators import login_required, user_passes_test
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Case, IntegerField, Q, Value, When
from django.http import HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_POST

from . import picking
from .forms import CsvImportForm, PhotoSearchForm
from .models import PluItem


def is_staff_user(user):
    return user.is_authenticated and user.is_staff


# Results a page: five, so a phone shows the answer and not a scroll, and
# the rest are a page away. The same figure for the page and the live
# search, so pressing Search and typing land on the same list.
PER_PAGE = 5

# The codes this shop actually reaches for. They are a small band in a list of
# a thousand, and they are most of what anybody searches for, so they sort
# above the rest rather than being hunted for among it. Both ends included.
PRIORITY_FIRST = 7000
PRIORITY_LAST = 7100


def _priority():
    """0 for a code in the priority band, 1 for everything else."""
    return Case(
        When(plu_no__gte=PRIORITY_FIRST, plu_no__lte=PRIORITY_LAST, then=Value(0)),
        default=Value(1),
        output_field=IntegerField(),
    )


def search_plu_items(q: str):
    """
    Ranked PLU search, shared by the search page and the live-search endpoint.

    Every word in the query has to appear in the description, but they don't
    have to be adjacent or in order: descriptions read "LAMB BONE-IN BBQ
    CHOPS", so a natural search like "lamb chops" finds nothing if the words
    are matched as one phrase.

    Results are ranked the way someone standing at the scale expects:

      1. the PLU they typed, if they typed one exactly — a code you type is a
         code you already know, and it outranks everything including the
         priority band;
      2. then the priority band (7000-7100), the codes this shop uses daily;
      3. then how well the row matches — code prefix, then description start,
         then description anywhere;
      4. and lowest PLU number within all of that.
    """
    qs = PluItem.objects.annotate(priority=_priority())

    if not q:
        return qs.order_by("priority", "plu_no")

    words = q.split()

    # Every word must be somewhere in the description...
    matches = Q()
    for word in words:
        matches &= Q(description__icontains=word)

    # ...unless the whole query is a PLU number, which matches the code too.
    whens = []
    exact = Value(1, output_field=IntegerField())
    if q.isdigit():
        matches |= Q(plu_no__icontains=q)
        whens.append(When(plu_no__startswith=q, then=Value(1)))
        # Typed in full, this is the one row they came for. It is kept out of
        # `rank` so that it sorts above the band rather than within it.
        exact = Case(
            When(plu_no=int(q), then=Value(0)),
            default=Value(1),
            output_field=IntegerField(),
        )

    whens += [
        When(description__istartswith=q, then=Value(2)),
        When(description__icontains=q, then=Value(3)),
    ]

    return (
        qs.filter(matches)
        .annotate(
            exact=exact,
            rank=Case(*whens, default=Value(4), output_field=IntegerField()),
        )
        .order_by("exact", "priority", "rank", "plu_no")
    )


@login_required
def plu_list(request):
    """
    Main PLU search page (home).

    Renders results server-side so the page works with JavaScript disabled;
    app.js layers live-as-you-type search on top via search_api below.

    Nothing is listed until something is searched for: on a phone, a
    thousand rows sitting under the box is just noise between you and the
    one code you came for.
    """
    q = (request.GET.get("q") or "").strip()

    page_obj = None
    if q:
        paginator = Paginator(search_plu_items(q), PER_PAGE)
        page_obj = paginator.get_page(request.GET.get("page"))

    # Real descriptions for the animated placeholder, so the examples always
    # match this shop's list instead of a hardcoded guess. Short ones only:
    # a long cut name types out for too long to read as a hint.
    examples = [
        d for d in PluItem.objects.order_by("?").values_list("description", flat=True)[:40]
        if len(d) <= 26
    ][:6]

    return render(
        request,
        "plu/plu_list.html",
        {
            "page_obj": page_obj,
            "q": q,
            "total_count": PluItem.objects.count(),
            "placeholder_examples": examples,
        },
    )


@login_required
def search_api(request):
    """
    JSON backing the live search on the list page: one page of PER_PAGE
    rows, cut the same way the page itself is, with `page` and `pages` so
    app.js can draw the same pager under them.

    An empty query comes back empty rather than as the whole table: the page
    shows a prompt until you type something.
    """
    q = (request.GET.get("q") or "").strip()

    if not q:
        return JsonResponse({"q": "", "total": 0, "page": 1, "pages": 1, "results": []})

    page_obj = Paginator(
        search_plu_items(q).values("plu_no", "description"), PER_PAGE
    ).get_page(request.GET.get("page"))

    return JsonResponse(
        {
            "q": q,
            "total": page_obj.paginator.count,
            "page": page_obj.number,
            "pages": page_obj.paginator.num_pages,
            "results": list(page_obj.object_list),
        }
    )


@login_required
def plu_detail(request, plu_no: int):
    """
    PLU detail page.
    """
    item = PluItem.objects.filter(plu_no=plu_no).first()
    if not item:
        messages.error(request, f"PLU {plu_no} not found.")
        return redirect("plu:list")

    return render(request, "plu/plu_detail.html", {"item": item})


# ---------------------------------------------------------------------------
# Photo search — a picking list photographed, each line named as a PLU
# ---------------------------------------------------------------------------

SESSION_KEY = "photo_search_lines"
SKIPPED_KEY = "photo_search_skipped"


def _remember(request, matched):
    """
    What the photo said, kept on the session so the page can be refreshed,
    a wrong line corrected, and the PDF made, without the photo again.
    """
    request.session[SESSION_KEY] = [
        {
            "line": line.text,
            "plu_no": match.item.plu_no,
            "score": match.score,
            "sureness": match.sureness,
            "by_code": match.by_code,
            "alternatives": [item.plu_no for item, _ in match.alternatives],
        }
        for line, match in matched
        if match.item is not None
    ]
    # A line nothing matched is left out — a name, a date, a note — and
    # only counted, so the page can say how many it passed over.
    request.session[SKIPPED_KEY] = sum(1 for _, match in matched if match.item is None)


def _recall(request):
    """The remembered lines with their items looked up, for a template."""
    rows = request.session.get(SESSION_KEY)
    if rows is None:
        return None
    # A read kept by an earlier version had only the line and its PLU;
    # it is still shown, as a plain match with nothing else to offer.
    wanted = set()
    for row in rows:
        if row.get("plu_no") is not None:
            wanted.add(row["plu_no"])
        wanted.update(row.get("alternatives") or [])
    items = {item.plu_no: item for item in PluItem.objects.filter(plu_no__in=wanted)}
    out = []
    for i, row in enumerate(rows):
        item = items.get(row.get("plu_no"))
        # Left blank by hand: gone from the list, but kept in place so the
        # other rows' numbers still point at them.
        if item is None:
            continue
        out.append({
            "index": i,
            "line": row.get("line", ""),
            "item": item,
            "score": row.get("score", 0.0),
            "sureness": row.get("sureness", "likely"),
            "by_code": row.get("by_code", False),
            "alternatives": [
                items[n] for n in (row.get("alternatives") or []) if n in items and items[n] is not item
            ],
        })
    return out


def _photo_context(request, form, error=None):
    rows = _recall(request)
    return {
        "form": form,
        "results": rows,
        "skipped": request.session.get(SKIPPED_KEY, 0),
        "error": error,
    }


@login_required
def photo_search(request):
    """
    Photograph a picking list; every line on it comes back named as a PLU.

    The photo is read by apps.plu.picking, which says how sure it is of
    each line and what else the line might have meant, so a doubtful row
    can be put right with a tap (photo_search_pick) before the PDF is
    made. app.js sends the photo by XMLHttpRequest and asks for the
    results alone; a browser without it posts the form and gets the page,
    and either way a refresh shows the last read, kept on the session.
    """
    form = PhotoSearchForm()
    error = None
    wants_fragment = request.headers.get("X-Requested-With") == "XMLHttpRequest"

    if request.method == "POST":
        form = PhotoSearchForm(request.POST, request.FILES)
        if not form.is_valid():
            error = "Choose a photo — a JPEG or PNG of the list."
        else:
            try:
                lines = picking.read_lines(form.cleaned_data["photo"])
            except picking.Unreadable as why:
                error = str(why)
            else:
                matched = picking.match_lines(lines, PluItem.objects.all())
                _remember(request, matched)
                if not request.session[SESSION_KEY]:
                    error = "Words were read, but none of them matched an item. Try the page filling the frame."

    if wants_fragment:
        return render(
            request, "plu/_photo_results.html", _photo_context(request, form, error),
            status=400 if error else 200,
        )
    if error:
        messages.error(request, error)
    return render(request, "plu/photo_search.html", _photo_context(request, form))


@login_required
@require_POST
def photo_search_pick(request):
    """
    Put a line right: this row of the last read now means this PLU, or no
    PLU at all. The change is kept on the session, so the PDF follows it.
    """
    rows = request.session.get(SESSION_KEY) or []
    try:
        index = int(request.POST.get("index", ""))
        row = rows[index]
    except (ValueError, IndexError):
        return JsonResponse({"error": "That line isn't on the last read."}, status=400)
    row.setdefault("alternatives", [])
    raw = (request.POST.get("plu_no") or "").strip()
    if raw:
        item = PluItem.objects.filter(plu_no=raw).first() if raw.isdigit() else None
        if item is None:
            return JsonResponse({"error": "No PLU with that number."}, status=400)
        row["plu_no"], row["sureness"], row["score"], row["by_code"] = item.plu_no, "picked", 1.0, False
    else:
        row["plu_no"], row["sureness"], row["score"], row["by_code"] = None, "none", 0.0, False
    request.session[SESSION_KEY] = rows
    if request.headers.get("X-Requested-With") == "XMLHttpRequest":
        if not raw:
            # Blanked: nothing to draw; app.js takes the row away.
            return HttpResponse(status=204)
        fresh = next(r for r in _recall(request) if r["index"] == index)
        return render(request, "plu/_photo_row.html", {"row": fresh})
    return redirect("plu:photo_search")


@login_required
@require_POST
def photo_search_clear(request):
    """The last read forgotten — the PDF is made, the list is done with."""
    request.session.pop(SESSION_KEY, None)
    request.session.pop(SKIPPED_KEY, None)
    if request.headers.get("X-Requested-With") == "XMLHttpRequest":
        return HttpResponse(status=204)
    return redirect("plu:photo_search")


@login_required
def photo_search_pdf(request):
    """
    Render the last photo-search result (from session) as a downloadable PDF:
    one row per picking-list line that was matched to a PLU.
    """
    lines = [row for row in request.session.get(SESSION_KEY) or [] if row.get("plu_no") is not None]
    plu_nos = {row["plu_no"] for row in lines}
    items_by_plu = {item.plu_no: item for item in PluItem.objects.filter(plu_no__in=plu_nos)}

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
    )

    styles = getSampleStyleSheet()
    elements = [Paragraph("PLU Picking List Result", styles["Title"]), Spacer(1, 12)]

    if lines:
        data = [["PLU No", "Line detected / Description"]]
        for row in lines:
            item = items_by_plu.get(row["plu_no"])
            plu_display = str(item.plu_no) if item else ""
            desc_display = item.description if item else row["line"]
            data.append([plu_display, desc_display])

        table = Table(data, colWidths=[1.0 * inch, 5.8 * inch], repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2b2b2b")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f2f2f2")]),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        elements.append(table)
    else:
        elements.append(Paragraph("No matching PLU found.", styles["Normal"]))

    doc.build(elements)
    buffer.seek(0)

    response = HttpResponse(buffer, content_type="application/pdf")
    response["Content-Disposition"] = 'attachment; filename="plu_photo_search_result.pdf"'
    return response


# PluItem only stores these two; any other column in the file is ignored.
REQUIRED_CSV_HEADERS = ("plu_no", "description")


@login_required
@user_passes_test(is_staff_user)
def import_csv(request):
    """
    Import page ONLY for staff/superuser.

    CSV must have a header row containing plu_no and description. Extra
    columns (sales_mode, price, tare and the like) are ignored, so exports
    from the till system can be uploaded unedited.
    """
    if request.method == "POST":
        form = CsvImportForm(request.POST, request.FILES)
        if form.is_valid():
            f = form.cleaned_data["csv_file"]

            try:
                decoded = f.read().decode("utf-8-sig")
            except Exception:
                messages.error(request, "Could not read that file. Please upload a valid UTF-8 CSV.")
                return redirect("plu:import")

            reader = csv.DictReader(io.StringIO(decoded))
            headers = {(h or "").strip() for h in (reader.fieldnames or [])}
            missing = [h for h in REQUIRED_CSV_HEADERS if h not in headers]

            if missing:
                messages.error(request, f"CSV is missing headers: {', '.join(missing)}")
                return redirect("plu:import")

            created = 0
            updated = 0
            skipped = 0

            with transaction.atomic():
                for row in reader:
                    plu_no_raw = (row.get("plu_no") or "").strip()
                    description = (row.get("description") or "").strip()

                    # A row is only usable with a numeric PLU and a description.
                    if not plu_no_raw or not description:
                        skipped += 1
                        continue

                    try:
                        plu_no = int(plu_no_raw)
                    except ValueError:
                        skipped += 1
                        continue

                    _, was_created = PluItem.objects.update_or_create(
                        plu_no=plu_no,
                        defaults={"description": description[:255]},
                    )
                    if was_created:
                        created += 1
                    else:
                        updated += 1

            messages.success(
                request,
                f"Import complete. Created: {created}, updated: {updated}, skipped: {skipped}.",
            )
            return redirect("plu:list")
        else:
            messages.error(request, "Please correct the errors below.")
    else:
        form = CsvImportForm()

    return render(
        request,
        "plu/import_csv.html",
        {"form": form, "required_headers": ", ".join(REQUIRED_CSV_HEADERS)},
    )