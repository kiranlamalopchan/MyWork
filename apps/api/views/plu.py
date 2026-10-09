"""
PLU lookup: the same ranked search the scale-side page ran, and the photo
search — a picking list photographed, every line named as a PLU — done
here without a session: the phone keeps the read and sends the rows back
for the PDF.
"""

from django.db.models.functions import Length
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from .catalogue import PrivateCatalogueView

from apps.plu import picking
from apps.plu.forms import PhotoSearchForm
from apps.plu.catalogue import items_for, selected_items, for_request, select_catalogue
from apps.plu.views import (
    PER_PAGE,
    REQUIRED_CSV_HEADERS,
    CsvProblem,
    import_rows,
    is_staff_user,
    picking_list_pdf,
    search_plu_items,
)

from .. import serialize


def _item(item):
    return {"plu_no": item.plu_no, "description": item.description}


# How many real rows the idle box is given, and how long a name may be to be
# one of them.
SAMPLE_LIMIT = 6
SAMPLE_MAX_LEN = 24


def _samples(user, catalogue_id=None):
    """
    A few real rows for the search box to show before anything is typed.

    Drawn from the list that was actually imported, because an invented
    example teaches the shape of somebody else's data: "red capsicum" is no
    help in a shop whose list says "CAPSICUM RED LOOSE".

    Short names are preferred — the box types them a character at a time, and
    a thirty-letter description is four seconds of watching rather than a
    hint — but if every name is long, any name beats none.
    """
    chosen = select_catalogue(user, catalogue_id)
    owned = items_for(user, chosen.pk) if chosen else items_for(user).none()
    short = owned.filter(plu_no__isnull=False).annotate(length=Length("description")).filter(length__lte=SAMPLE_MAX_LEN)
    rows = list(short.order_by("?")[:SAMPLE_LIMIT])
    return [_item(i) for i in rows or owned.filter(plu_no__isnull=False).order_by("?")[:SAMPLE_LIMIT]]


class Search(PrivateCatalogueView):
    def get(self, request):
        q = (request.GET.get("q") or "").strip()
        if not q:
            # Nothing asked for yet: how many there are to search, for the
            # words under the box, and a few of them for the box itself.
            return Response({
                "q": q, "results": [], "page": 1, "pages": 1, "count": 0, "next": None,
                "total": selected_items(request).filter(plu_no__isnull=False).count(),
                "samples": _samples(request.user, for_request(request).pk if for_request(request) else None),
            })
        page, meta = serialize.page_of(request, search_plu_items(q, request.user, for_request(request).pk if for_request(request) else None), PER_PAGE)
        meta["q"] = q
        meta["results"] = [_item(i) for i in page.object_list]
        return Response(meta)


class Detail(PrivateCatalogueView):
    def get(self, request, plu_no):
        return Response(_item(get_object_or_404(selected_items(request), plu_no=plu_no)))


class Import(PrivateCatalogueView):
    """
    The site's staff-only CSV import (`plu:import`), for the app.

    GET says whether this account may import and what the file needs, so the
    screen can show the button — or not — without guessing at the rules.
    POST file=<csv> writes it in and answers with what it did.
    """

    def get(self, request):
        return Response({
            "allowed": is_staff_user(request.user),
            "headers": list(REQUIRED_CSV_HEADERS),
            "total": selected_items(request).filter(plu_no__isnull=False).count(),
        })

    def post(self, request):
        # The same gate the site's page is behind, said in the API's words.
        if not is_staff_user(request.user):
            raise PermissionDenied("Only a manager can import the PLU list.")
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"detail": "Choose a CSV file to import."})
        try:
            created, updated, skipped = import_rows(upload, request.user, for_request(request).pk if for_request(request) else None)
        except CsvProblem as problem:
            raise ValidationError({"detail": str(problem)})
        # A first import creates the default catalogue after selection was cached.
        delattr(request, "_item_catalogue")
        return Response({
            "created": created,
            "updated": updated,
            "skipped": skipped,
            "total": selected_items(request).filter(plu_no__isnull=False).count(),
            "message": f"Import complete. Created: {created}, updated: {updated}, skipped: {skipped}.",
        })


class Photo(PrivateCatalogueView):
    """
    POST photo=<image>: the lines read off it, each with the item it most
    likely means, how sure that is, and what else it might have meant —
    the same reading and matching as the page did (apps.plu.picking).
    """

    def post(self, request):
        form = PhotoSearchForm(request.data, request.FILES)
        if not form.is_valid():
            raise ValidationError({"detail": "Choose a photo of the list — a JPEG, PNG or HEIC."})
        try:
            lines = picking.read_lines(form.cleaned_data["photo"])
        except picking.Unreadable as why:
            raise ValidationError({"detail": str(why)})
        matched = picking.match_lines(lines, selected_items(request).filter(plu_no__isnull=False))
        rows = [
            {
                "line": line.text,
                "item": _item(match.item),
                "score": round(match.score, 3),
                "sureness": match.sureness,
                "by_code": match.by_code,
                "alternatives": [_item(item) for item, _ in match.alternatives if item is not match.item],
            }
            for line, match in matched
            if match.item is not None
        ]
        skipped = sum(1 for _, match in matched if match.item is None)
        if not rows:
            raise ValidationError({"detail": "Words were read, but none of them matched an item. Try the page filling the frame."})
        return Response({"rows": rows, "skipped": skipped})


class PhotoPdf(PrivateCatalogueView):
    """POST {"rows": [{"plu_no", "line"}]}: the read, as the picking-list PDF."""

    def post(self, request):
        rows = request.data.get("rows")
        if not isinstance(rows, list):
            raise ValidationError({"detail": "Send the rows to print."})
        lines = []
        for row in rows:
            try:
                lines.append({"plu_no": int(row["plu_no"]), "line": str(row.get("line", ""))})
            except (KeyError, TypeError, ValueError):
                raise ValidationError({"detail": "Each row needs a PLU number."})
        return picking_list_pdf(lines, request.user, for_request(request).pk if for_request(request) else None)
