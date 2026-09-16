# mywork/media_serve.py
#
# `django.views.static.serve` — what `runserver` uses for MEDIA_ROOT in
# development — always answers with the whole file, whatever the request
# asked for. A browser tolerates that; AVPlayer does not. Before it plays a
# network video it sends a small `Range` request to see whether the server
# can be scrubbed, and a plain 200 back where a 206 was promised reads as a
# broken server, so it refuses the whole clip. In production the web server
# (PythonAnywhere's, standing in front of MEDIA_ROOT directly) already
# answers Range requests properly — this is only for `runserver`.

import mimetypes
import re
from pathlib import Path

from django.http import FileResponse, Http404, HttpResponse
from django.utils._os import safe_join

RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


def serve(request, path, document_root=None):
    fullpath = Path(safe_join(document_root, path))
    if not fullpath.is_file():
        raise Http404(f"“{path}” does not exist")

    size = fullpath.stat().st_size
    content_type = mimetypes.guess_type(str(fullpath))[0] or "application/octet-stream"

    match = RANGE_RE.match(request.META.get("HTTP_RANGE", ""))
    if not match:
        response = FileResponse(fullpath.open("rb"), content_type=content_type)
        response.headers["Accept-Ranges"] = "bytes"
        return response

    start = int(match.group(1) or 0)
    end = min(int(match.group(2)) if match.group(2) else size - 1, size - 1)
    if start >= size or start > end:
        return HttpResponse(status=416, headers={"Content-Range": f"bytes */{size}"})

    with fullpath.open("rb") as f:
        f.seek(start)
        chunk = f.read(end - start + 1)
    response = HttpResponse(chunk, status=206, content_type=content_type)
    response.headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    response.headers["Accept-Ranges"] = "bytes"
    return response
