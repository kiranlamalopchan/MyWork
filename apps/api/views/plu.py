"""PLU lookup: the same ranked search the scale-side page runs."""

from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.plu.models import PluItem
from apps.plu.views import PER_PAGE, search_plu_items

from .. import serialize


def _item(item):
    return {"plu_no": item.plu_no, "description": item.description}


class Search(APIView):
    def get(self, request):
        q = (request.GET.get("q") or "").strip()
        if not q:
            return Response({"q": q, "results": [], "page": 1, "pages": 1, "count": 0, "next": None})
        page, meta = serialize.page_of(request, search_plu_items(q), PER_PAGE)
        meta["q"] = q
        meta["results"] = [_item(i) for i in page.object_list]
        return Response(meta)


class Detail(APIView):
    def get(self, request, plu_no):
        return Response(_item(get_object_or_404(PluItem, plu_no=plu_no)))
