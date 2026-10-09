from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.http import JsonResponse
from django.urls import reverse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.cache import never_cache

from . import catalogue


@login_required
@never_cache
def item_list(request):
    q = (request.GET.get("q") or "").strip()[:500]
    config = catalogue.for_request(request)
    owned = catalogue.selected_items(request)
    page = Paginator(catalogue.search_items(request.user, q, config.pk if config else None), 20).get_page(request.GET.get("page")) if q else None
    return render(request, "plu/plu_list.html", {"show_catalogues": request.GET.get("view") == "catalogues", "q": q, "page_obj": page, "catalogue": config,
        "catalogues": catalogue.catalogue_choices(request.user), "total_count": owned.count(), "placeholder_examples": list(owned.order_by("pk").values_list("title", flat=True)[:6])})


@login_required
@never_cache
def search_api(request):
    q = (request.GET.get("q") or "").strip()[:500]
    config = catalogue.for_request(request)
    page = Paginator(catalogue.search_items(request.user, q, config.pk if config else None) if q else catalogue.selected_items(request).none(), 20).get_page(request.GET.get("page"))
    return JsonResponse({"q": q, "total": page.paginator.count, "page": page.number,
        "pages": page.paginator.num_pages, "results": [catalogue.item_data(i) for i in page]})


@login_required
@never_cache
def item_detail(request, plu_no):
    item = get_object_or_404(catalogue.items_for(request.user), pk=plu_no)
    request._item_catalogue = item.catalogue
    request.session["item_catalogue"] = item.catalogue_id
    return render(request, "plu/plu_detail.html", {"item": item, "field_rows": list(item.fields.items())})


@login_required
@never_cache
def import_csv(request):
    preview = None
    mapping = None
    error = None
    if request.method == "POST":
        try:
            if request.POST.get("upload_id"):
                mapping = request.POST.dict()
                mapping["search_columns"] = request.POST.getlist("search_columns")
                result = catalogue.import_upload(request.user, request.POST["upload_id"], mapping)
                messages.success(request, result["message"])
                # Old photo results cannot outlive a replaced catalogue.
                request.session.pop("photo_search_lines", None)
                request.session["item_catalogue"] = result["catalogue_id"]
                return redirect(reverse("plu:list") + f"?catalogue={result['catalogue_id']}")
            upload = catalogue.stage_upload(request.user, request.FILES.get("csv_file"))
            preview = catalogue.preview_data(upload)
            mapping = preview["defaults"]
        except catalogue.CatalogueProblem as problem:
            error = str(problem)
            if request.POST.get("upload_id"):
                try:
                    preview = catalogue.preview_data(catalogue.get_upload(request.user, request.POST["upload_id"]))
                except catalogue.CatalogueProblem:
                    pass
    if preview:
        preview["sample_values"] = [[row[h] for h in preview["headers"]] for row in preview["sample"]]
    return render(request, "plu/import_csv.html", {"preview": preview, "mapping": mapping, "error": error,
        "catalogues": catalogue.catalogue_choices(request.user)})
