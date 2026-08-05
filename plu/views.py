# plu/views.py
import csv
import io
import re

import pytesseract
from PIL import Image
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


def _find_plu_matches(ocr_text: str):
    """
    Match OCR'd label text against PluItem records.
    Digit runs are checked as exact plu_no matches first (highest confidence).
    Remaining words are matched against the description and ranked by how many
    of the detected words each item contains, so a single generic word (e.g.
    "BEEF") doesn't drown out items that match on multiple words.
    """
    text = ocr_text or ""

    digit_candidates = {int(d) for d in re.findall(r"\d{3,6}", text)}
    exact_matches = list(PluItem.objects.filter(plu_no__in=digit_candidates).order_by("plu_no"))

    words = [w.upper() for w in re.sub(r"[^A-Za-z\s]", " ", text).split() if len(w) > 2]
    words = list(dict.fromkeys(words))[:8]

    desc_matches = []
    if words:
        q = Q()
        for w in words:
            q |= Q(description__icontains=w)
        candidates = PluItem.objects.filter(q)[:500]

        scored = []
        for item in candidates:
            desc_upper = item.description.upper()
            score = sum(1 for w in words if w in desc_upper)
            scored.append((score, item))
        scored.sort(key=lambda t: (-t[0], t[1].plu_no))

        # Require at least 2 matching words when more than one word was
        # detected, so a single generic word (e.g. "BEEF") doesn't flood
        # the results with unrelated items.
        min_score = 2 if len(words) >= 2 else 1
        desc_matches = [item for score, item in scored[:10] if score >= min_score]

    seen = set()
    results = []
    for item in exact_matches + desc_matches:
        if item.plu_no not in seen:
            seen.add(item.plu_no)
            results.append(item)
    return results


@login_required
def photo_search(request):
    """
    Upload/capture a photo of a PLU label, OCR it, and show matching PLU records.
    Results are cached in the session so they can be re-downloaded as a PDF.
    """
    results = None
    ocr_text = ""

    if request.method == "POST":
        form = PhotoSearchForm(request.POST, request.FILES)
        if form.is_valid():
            try:
                image = Image.open(form.cleaned_data["photo"])
                ocr_text = pytesseract.image_to_string(image)
            except Exception:
                messages.error(request, "Could not read that photo. Please try a clearer image.")
                return render(request, "plu/photo_search.html", {"form": form, "results": None, "ocr_text": ""})

            results = _find_plu_matches(ocr_text)

            request.session["photo_search_ocr_text"] = ocr_text
            request.session["photo_search_plu_nos"] = [item.plu_no for item in results]

            if not results:
                messages.warning(request, "No PLU match found for the text detected in the photo.")
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
    Render the last photo-search result (from session) as a downloadable PDF.
    """
    plu_nos = request.session.get("photo_search_plu_nos") or []
    ocr_text = request.session.get("photo_search_ocr_text") or ""
    items = list(PluItem.objects.filter(plu_no__in=plu_nos).order_by("plu_no"))

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
    elements = [Paragraph("PLU Photo Search Result", styles["Title"]), Spacer(1, 12)]

    if ocr_text.strip():
        elements.append(Paragraph(f"<b>Text detected in photo:</b> {ocr_text.strip()}", styles["Normal"]))
        elements.append(Spacer(1, 12))

    if items:
        data = [["PLU No", "Description"]]
        for item in items:
            data.append([str(item.plu_no), item.description])

        table = Table(data, colWidths=[1.2 * inch, 5.6 * inch], repeatRows=1)
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