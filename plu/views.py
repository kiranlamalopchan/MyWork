# plu/views.py
import csv
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
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required, user_passes_test
from django.contrib.auth.forms import UserCreationForm
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import redirect, render
from django.urls import reverse

from .forms import CsvImportForm, PhotoSearchForm
from .models import PluItem


def is_staff_user(user):
    return user.is_authenticated and user.is_staff


def home_redirect(request):
    """
    Open login page first.
    If already logged in, go to PLU list (home/search page).
    """
    if request.user.is_authenticated:
        return redirect("plu:list")
    return redirect("plu:login")


def register(request):
    """
    Public registration page.
    After successful registration -> log them in -> go to PLU list.
    """
    if request.user.is_authenticated:
        return redirect("plu:list")

    if request.method == "POST":
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            messages.success(request, "Account created. You are now logged in.")
            return redirect("plu:list")
        else:
            messages.error(request, "Please correct the errors below.")
    else:
        form = UserCreationForm()

    return render(request, "registration/register.html", {"form": form})


@login_required
def plu_list(request):
    """
    Main PLU search page (home).
    Search by PLU number or description.
    """
    q = (request.GET.get("q") or "").strip()

    qs = PluItem.objects.all().order_by("plu_no")  # ordered to avoid pagination warning

    if q:
        # If user types only digits -> search PLU contains + description contains
        if q.isdigit():
            qs = qs.filter(Q(plu_no__icontains=q) | Q(description__icontains=q))
        else:
            qs = qs.filter(description__icontains=q)

    paginator = Paginator(qs, 25)
    page_number = request.GET.get("page")
    page_obj = paginator.get_page(page_number)

    total_count = PluItem.objects.count()

    return render(
        request,
        "plu/plu_list.html",
        {
            "page_obj": page_obj,
            "q": q,
            "total_count": total_count,
        },
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


def _match_line(line: str):
    """
    Best-effort match of a single picking-list line to a PluItem, purely by
    item name/description. Numbers in the line (weights, quantities, PLU
    codes printed on the sheet) are ignored entirely; the PluItem whose
    description shares the most words with the line wins. Returns None if
    nothing scores at least one shared word.
    """
    words = [w.upper() for w in re.sub(r"[^A-Za-z\s]", " ", line).split() if len(w) > 2]
    words = list(dict.fromkeys(words))[:8]
    if not words:
        return None

    q = Q()
    for w in words:
        q |= Q(description__icontains=w)
    candidates = PluItem.objects.filter(q)[:200]

    # On a tied score, prefer the shorter description: it's the tighter,
    # more literal match rather than a longer one that happens to contain
    # all the same words as a subset (e.g. "LAMB MINCE" over "LAMB
    # BONELESS LAMB YIROS MINCE" when both match "LAMB" and "MINCE").
    best_item, best_score, best_len = None, 0, None
    for item in candidates:
        desc_upper = item.description.upper()
        score = sum(1 for w in words if w in desc_upper)
        if score == 0:
            continue
        desc_len = len(desc_upper)
        if score > best_score or (score == best_score and desc_len < best_len):
            best_item, best_score, best_len = item, score, desc_len

    return best_item


def _find_plu_matches(ocr_text: str):
    """
    Match each line of an OCR'd picking list to a PLU. Returns a list of
    {"line": str, "item": PluItem or None} dicts, one per non-empty line, so
    the picking list can be reviewed line-by-line and blanks are obvious.
    """
    results = []
    for raw_line in (ocr_text or "").splitlines():
        line = raw_line.strip()
        if len(line) < 3:
            continue
        results.append({"line": line, "item": _match_line(line)})
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


@login_required
@user_passes_test(is_staff_user)
def import_csv(request):
    """
    Import page ONLY for staff/superuser.
    CSV headers must include: plu_no, description, sales_mode, price, tare
    """
    if request.method == "POST":
        form = CsvImportForm(request.POST, request.FILES)
        if form.is_valid():
            f = form.cleaned_data["csv_file"]

            try:
                decoded = f.read().decode("utf-8-sig")
            except Exception:
                messages.error(request, "Could not read file. Please upload a valid UTF-8 CSV.")
                return redirect("plu:import")

            reader = csv.DictReader(io.StringIO(decoded))
            required = {"plu_no", "description", "sales_mode", "price", "tare"}
            headers = set([h.strip() for h in (reader.fieldnames or [])])

            if not required.issubset(headers):
                missing = ", ".join(sorted(required - headers))
                messages.error(request, f"CSV is missing headers: {missing}")
                return redirect("plu:import")

            created = 0
            updated = 0
            skipped = 0

            with transaction.atomic():
                for row in reader:
                    try:
                        plu_no_raw = (row.get("plu_no") or "").strip()
                        if not plu_no_raw:
                            skipped += 1
                            continue

                        plu_no = int(plu_no_raw)

                        description = (row.get("description") or "").strip()
                        sales_mode = (row.get("sales_mode") or "").strip() or "Weight"

                        price_raw = (row.get("price") or "").strip()
                        tare_raw = (row.get("tare") or "").strip()

                        # Safe parsing
                        price = float(price_raw) if price_raw else 0.0
                        tare = float(tare_raw) if tare_raw else 0.0

                        obj, was_created = PluItem.objects.update_or_create(
                            plu_no=plu_no,
                            defaults={
                                "description": description,
                                "sales_mode": sales_mode,
                                "price": price,
                                "tare": tare,
                            },
                        )
                        if was_created:
                            created += 1
                        else:
                            updated += 1
                    except Exception:
                        skipped += 1

            messages.success(
                request,
                f"Import complete. Created: {created}, Updated: {updated}, Skipped: {skipped}.",
            )
            return redirect("plu:list")
        else:
            messages.error(request, "Please correct the errors below.")
    else:
        form = CsvImportForm()

    return render(request, "plu/import_csv.html", {"form": form, "required_headers": "plu_no, description, sales_mode, price, tare"})