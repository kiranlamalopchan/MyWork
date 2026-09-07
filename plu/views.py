# plu/views.py
import csv
import difflib
import io
import re

import pytesseract
from PIL import Image, ImageOps
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

from .forms import CsvImportForm, PhotoSearchForm
from .models import PluItem


def is_staff_user(user):
    return user.is_authenticated and user.is_staff


# Live search sends a request per typing pause, so cap what comes back; the
# result list is scrolled on a phone and nobody scrolls past a few dozen rows.
SEARCH_LIMIT = 50


def search_plu_items(q: str):
    """
    Ranked PLU search, shared by the search page and the live-search endpoint.

    Every word in the query has to appear in the description, but they don't
    have to be adjacent or in order: descriptions read "LAMB BONE-IN BBQ
    CHOPS", so a natural search like "lamb chops" finds nothing if the words
    are matched as one phrase.

    Results are ranked the way someone standing at the scale expects: the PLU
    they typed exactly, then codes starting with those digits, then the
    closest description matches. Within a rank, lowest PLU number first.
    """
    qs = PluItem.objects.all()

    if not q:
        return qs.order_by("plu_no")

    words = q.split()

    # Every word must be somewhere in the description...
    matches = Q()
    for word in words:
        matches &= Q(description__icontains=word)

    # ...unless the whole query is a PLU number, which matches the code too.
    whens = []
    if q.isdigit():
        matches |= Q(plu_no__icontains=q)
        whens += [
            When(plu_no=int(q), then=Value(0)),
            When(plu_no__startswith=q, then=Value(1)),
        ]

    whens += [
        When(description__istartswith=q, then=Value(2)),
        When(description__icontains=q, then=Value(3)),
    ]

    return (
        qs.filter(matches)
        .annotate(rank=Case(*whens, default=Value(4), output_field=IntegerField()))
        .order_by("rank", "plu_no")
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
        paginator = Paginator(search_plu_items(q), 25)
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
    JSON backing the live search on the list page. Returns at most
    SEARCH_LIMIT rows, and says so via `truncated` when there are more.

    An empty query comes back empty rather than as the whole table: the page
    shows a prompt until you type something.
    """
    q = (request.GET.get("q") or "").strip()

    if not q:
        return JsonResponse({"q": "", "total": 0, "truncated": False, "results": []})

    qs = search_plu_items(q)
    total = qs.count()
    rows = qs.values("plu_no", "description")[:SEARCH_LIMIT]

    return JsonResponse(
        {
            "q": q,
            "total": total,
            "truncated": total > SEARCH_LIMIT,
            "results": list(rows),
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


def _preprocess_photo(image: Image.Image) -> Image.Image:
    """
    Clean up a phone photo of a picking list before OCR: fix camera-reported
    rotation, auto-correct sideways/upside-down pages, boost contrast, and
    upscale small images. Dense small print reads far better after this than
    fed to Tesseract raw.
    """
    image = ImageOps.exif_transpose(image)
    image = image.convert("L")

    try:
        osd = pytesseract.image_to_osd(image)
        angle_match = re.search(r"Rotate:\s*(\d+)", osd)
        confidence_match = re.search(r"Orientation confidence:\s*([\d.]+)", osd)
        angle = int(angle_match.group(1)) if angle_match else 0
        confidence = float(confidence_match.group(1)) if confidence_match else 0.0
        # Low-confidence OSD readings are a coin flip and can rotate an
        # already-correct image into an unreadable one, so only act on
        # confident readings.
        if angle and confidence >= 2.0:
            image = image.rotate(-angle, expand=True, fillcolor=255)
    except Exception:
        pass

    image = ImageOps.autocontrast(image)

    if image.width < 1800:
        scale = 1800 / image.width
        image = image.resize((int(image.width * scale), int(image.height * scale)), Image.LANCZOS)

    return image


def _match_line(line: str, all_items: list):
    """
    Best-effort match of a single picking-list line to a PluItem, purely by
    item name/description. Numbers in the line (weights, quantities, PLU
    codes printed on the sheet) are ignored entirely.

    First tries to find the item sharing the most whole words with the line.
    If nothing shares even one word, falls back to the closest fuzzy string
    match across every item so a line always surfaces a best-effort PLU
    instead of coming back blank. Only returns None when the line has no
    recognizable words at all.
    """
    words = [w.upper() for w in re.sub(r"[^A-Za-z\s]", " ", line).split() if len(w) > 2]
    words = list(dict.fromkeys(words))[:8]
    if not words:
        return None

    # On a tied score, prefer the shorter description: it's the tighter,
    # more literal match rather than a longer one that happens to contain
    # all the same words as a subset (e.g. "LAMB MINCE" over "LAMB
    # BONELESS LAMB YIROS MINCE" when both match "LAMB" and "MINCE").
    best_item, best_score, best_len = None, 0, None
    for item in all_items:
        desc_upper = item.description.upper()
        score = sum(1 for w in words if w in desc_upper)
        if score == 0:
            continue
        desc_len = len(desc_upper)
        if score > best_score or (score == best_score and desc_len < best_len):
            best_item, best_score, best_len = item, score, desc_len

    if best_item:
        return best_item

    # No shared words at all - fall back to whichever description reads
    # closest to the line, so we always write "the one you get" rather
    # than leaving the line blank.
    line_text = " ".join(words)
    best_fuzzy, best_ratio = None, -1.0
    for item in all_items:
        ratio = difflib.SequenceMatcher(None, line_text, item.description.upper()).ratio()
        if ratio > best_ratio:
            best_fuzzy, best_ratio = item, ratio
    return best_fuzzy


def _find_plu_matches(ocr_text: str):
    """
    Match each line of an OCR'd picking list to a PLU. Returns a list of
    {"line": str, "item": PluItem or None} dicts, one per non-empty line.
    item is only None when the line has no readable words to match on.
    """
    all_items = list(PluItem.objects.all())
    results = []
    for raw_line in (ocr_text or "").splitlines():
        line = raw_line.strip()
        if len(line) < 3:
            continue
        results.append({"line": line, "item": _match_line(line, all_items)})
    return results


@login_required
def photo_search(request):
    """
    Upload/capture a photo of a picking list, OCR it line by line, and show
    the best PLU match for each line. Results are cached in the session so
    they can be re-downloaded as a PDF without re-uploading the photo.
    """
    results = None
    ocr_text = ""

    if request.method == "POST":
        form = PhotoSearchForm(request.POST, request.FILES)
        if form.is_valid():
            try:
                image = Image.open(form.cleaned_data["photo"])
                image = _preprocess_photo(image)
                ocr_text = pytesseract.image_to_string(image, config="--psm 6")
            except Exception:
                messages.error(request, "Could not read that photo. Please try a clearer image.")
                return render(request, "plu/photo_search.html", {"form": form, "results": None, "ocr_text": ""})

            results = _find_plu_matches(ocr_text)

            request.session["photo_search_ocr_text"] = ocr_text
            request.session["photo_search_lines"] = [
                {"line": r["line"], "plu_no": r["item"].plu_no if r["item"] else None} for r in results
            ]

            if not results:
                messages.warning(request, "No text could be matched to a PLU in that photo.")
        else:
            messages.error(request, "Please upload a valid image.")
    else:
        form = PhotoSearchForm()

    return render(
        request,
        "plu/photo_search.html",
        {"form": form, "results": results, "ocr_text": ocr_text},
    )


@login_required
def photo_search_pdf(request):
    """
    Render the last photo-search result (from session) as a downloadable PDF:
    one row per picking-list line, with its matched PLU or blank if none.
    """
    lines = request.session.get("photo_search_lines") or []
    plu_nos = {row["plu_no"] for row in lines if row["plu_no"] is not None}
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