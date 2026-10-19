from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.http import JsonResponse
from django.urls import reverse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from . import catalogue


@login_required
@never_cache
def item_list(request):
    q = (request.GET.get("q") or "").strip()[:500]
    config = catalogue.for_request(request)
    owned = catalogue.selected_items(request)
    page = Paginator(catalogue.search_items(request.user, q, config.pk if config else None), catalogue.SEARCH_PAGE_SIZE).get_page(request.GET.get("page")) if q else None
    return render(request, "plu/plu_list.html", {"show_catalogues": request.GET.get("view") == "catalogues", "q": q, "page_obj": page, "catalogue": config,
        "catalogues": catalogue.catalogue_choices(request.user), "total_count": owned.count()})


@login_required
@never_cache
def search_api(request):
    q = (request.GET.get("q") or "").strip()[:500]
    config = catalogue.for_request(request)
    page = Paginator(catalogue.search_items(request.user, q, config.pk if config else None) if q else catalogue.selected_items(request).none(), catalogue.SEARCH_PAGE_SIZE).get_page(request.GET.get("page"))
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
@require_http_methods(["GET", "POST"])
def edit_catalogue(request, pk):
    chosen = catalogue.select_catalogue(request.user, pk)
    error = None
    values = {"name": chosen.name, "search_columns": chosen.search_columns}
    if request.method == "POST":
        values = {"name": request.POST.get("name", ""), "search_columns": request.POST.getlist("search_columns")}
        try:
            catalogue.update_catalogue(request.user, pk, values)
            messages.success(request, "Catalogue updated.")
            return redirect(reverse("plu:list") + "?view=catalogues")
        except catalogue.CatalogueProblem as problem:
            error = str(problem)
    return render(request, "plu/catalogue_edit.html", {"managed_catalogue": chosen, "values": values, "error": error})


@login_required
@never_cache
@require_http_methods(["GET", "POST"])
def remove_catalogue(request, pk):
    chosen = catalogue.select_catalogue(request.user, pk)
    if request.method == "POST":
        catalogue.delete_catalogue(request.user, pk)
        if request.session.get("item_catalogue") == pk:
            request.session.pop("item_catalogue", None)
        if request.session.get("photo_search_catalogue") == pk:
            request.session.pop("photo_search_lines", None)
            request.session.pop("photo_search_catalogue", None)
        messages.success(request, "Catalogue deleted.")
        return redirect(reverse("plu:list") + "?view=catalogues")
    return render(request, "plu/catalogue_delete.html", {"managed_catalogue": chosen})


@login_required
@never_cache
def import_csv(request):
    target = catalogue.select_catalogue(request.user, request.GET["catalogue"]) if request.GET.get("catalogue") else None
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
                return redirect(reverse("plu:list") + f"?view=catalogues&catalogue={result['catalogue_id']}")
            upload = catalogue.stage_upload(request.user, request.FILES.get("csv_file"))
            preview = catalogue.preview_data(upload)
            mapping = preview["defaults"]
            if target:
                mapping = {**mapping, "catalogue_id": str(target.pk), "name": target.name}
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
