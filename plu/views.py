# plu/views.py
import csv
import io

from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required, user_passes_test
from django.contrib.auth.forms import UserCreationForm
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Q
from django.shortcuts import redirect, render
from django.urls import reverse

from .forms import CsvImportForm
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