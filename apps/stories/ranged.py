"""
A video served a piece at a time.

An iPhone's player does not download a video and then play it: it asks for
the first two bytes to learn the file's size, then for the stretches it
wants, with HTTP `Range` headers — and it refuses outright a server that
answers those with the whole file. The static file server on PythonAnywhere
does exactly that (200 and everything, whatever the range asked), so a
story video under /media/ played on Android and in every browser and was a
black frame on iOS. This is the range-honouring answer, for videos only —
pictures are fine where they are.
"""
import os
import re

from django.http import FileResponse, HttpResponse, HttpResponseNotModified
from django.utils.http import http_date

# One range, "bytes=start-end" with either side open; several at once are
# not worth the trouble and no player sends them.
RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


class _Slice:
    """A window on an open file, read out in chunks and closed after."""

    def __init__(self, f, start, length, block=64 * 1024):
        self.f, self.left, self.block = f, length, block
        f.seek(start)

    def __iter__(self):
        return self

    def __next__(self):
        if self.left <= 0:
            raise StopIteration
        data = self.f.read(min(self.block, self.left))
        if not data:
            raise StopIteration
        self.left -= len(data)
        return data

    def close(self):
        self.f.close()


def ranged_file_response(request, path, content_type):
    """
    The file at `path`, whole or the part the request's Range asked for:
    206 with Content-Range for a range, 416 for one past the end, 200 with
    Accept-Ranges for none. Answers HEAD without reading the file.
    """
    stat = os.stat(path)
    size = stat.st_size
    modified = http_date(stat.st_mtime)
    if request.META.get("HTTP_IF_MODIFIED_SINCE") == modified:
        return HttpResponseNotModified()

    header = request.META.get("HTTP_RANGE", "")
    match = RANGE.match(header.strip()) if header else None
    if match and size:
        first, last = match.groups()
        if first == "" and last == "":
            match = None
        elif first == "":
            # "-500": the last 500 bytes.
            start = max(size - int(last), 0)
            end = size - 1
        else:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        if match and (start >= size or start > end):
            response = HttpResponse(status=416, content_type=content_type)
            response["Content-Range"] = f"bytes */{size}"
            return response

    if match:
        length = end - start + 1
        body = _Slice(open(path, "rb"), start, length) if request.method != "HEAD" else b""
        response = FileResponse(body, status=206, content_type=content_type) if body != b"" else HttpResponse(status=206, content_type=content_type)
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
        response["Content-Length"] = str(length)
    else:
        body = open(path, "rb") if request.method != "HEAD" else b""
        response = FileResponse(body, content_type=content_type) if body != b"" else HttpResponse(content_type=content_type)
        response["Content-Length"] = str(size)

    response["Accept-Ranges"] = "bytes"
    response["Last-Modified"] = modified
    # A story lives a day and its file is named at random: safe to keep.
    response["Cache-Control"] = "public, max-age=86400"
    return response
