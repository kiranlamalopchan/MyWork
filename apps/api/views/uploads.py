"""
A big file sent a piece at a time.

The host's front proxy (PythonAnywhere) refuses any request over 100 MiB
with a 413 before Django sees it, and a minute of phone video is often two
or three times that. So the app cuts a large video into pieces, posts each
one here in turn, and then creates the story by naming the assembled upload
instead of attaching the file (see stories.Tray.post). The pieces arrive as
base64 in JSON — a phone can read a slice of a file that way without
loading the whole thing — and are appended to one file under MEDIA_ROOT.

Nothing is kept in the database: the upload id is the client's, the file
is scoped by the user's id so nobody can append to anybody else's, and a
piece never claimed is swept when it is a day old.
"""
import base64
import os
import re
import time

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

UPLOAD_ID = re.compile(r"^[0-9a-f]{16,40}$")
DIR = "uploads"
# More than any story video could need, and a bound on what one person can
# put on the disk in a day.
MAX_BYTES = 600 * 1024 * 1024
STALE_AFTER = 24 * 3600


def _dir():
    path = os.path.join(settings.MEDIA_ROOT, DIR)
    os.makedirs(path, exist_ok=True)
    return path


def part_path(user, upload_id):
    """Where this person's upload is being assembled, or None for a bad id."""
    if not UPLOAD_ID.match(upload_id or ""):
        return None
    return os.path.join(_dir(), f"{user.pk}-{upload_id}.part")


def sweep():
    """Drop pieces nobody came back for."""
    now = time.time()
    try:
        for name in os.listdir(_dir()):
            path = os.path.join(_dir(), name)
            try:
                if now - os.stat(path).st_mtime > STALE_AFTER:
                    os.unlink(path)
            except OSError:
                pass
    except OSError:
        pass


def take(user, upload_id, filename, content_type=""):
    """
    The assembled upload as something a form can treat as a file, or None
    when there is no such upload. The caller deletes it when done (see
    `discard`) — the file stays open for reading until then.
    """
    path = part_path(user, upload_id)
    if not path or not os.path.exists(path):
        return None
    f = open(path, "rb")
    return UploadedFile(file=f, name=os.path.basename(filename or "video.mp4"), content_type=content_type or "video/mp4", size=os.path.getsize(path))


def discard(user, upload_id):
    path = part_path(user, upload_id)
    if path:
        try:
            os.unlink(path)
        except OSError:
            pass


class Upload(APIView):
    """
    One piece: {"upload_id", "index", "total", "data"} with `data` base64.
    Pieces are appended in the order they arrive, which is the order the
    app sends them — it waits for each answer before the next. The first
    piece (index 0) starts the file afresh, so a retry from the top is safe.
    """

    def post(self, request):
        upload_id = str(request.data.get("upload_id") or "")
        path = part_path(request.user, upload_id)
        if not path:
            return Response({"detail": "A bad upload id."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            index = int(request.data.get("index"))
            total = int(request.data.get("total"))
            data = base64.b64decode(request.data.get("data") or "", validate=True)
        except (TypeError, ValueError):
            return Response({"detail": "A piece needs index, total and data."}, status=status.HTTP_400_BAD_REQUEST)
        if index == 0:
            sweep()
        mode = "wb" if index == 0 else "ab"
        if mode == "ab" and not os.path.exists(path):
            return Response({"detail": "That upload hasn't started. Send piece 0 first."}, status=status.HTTP_409_CONFLICT)
        have = os.path.getsize(path) if os.path.exists(path) and mode == "ab" else 0
        if have + len(data) > MAX_BYTES:
            discard(request.user, upload_id)
            return Response({"detail": "That video is too big to send."}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        with open(path, mode) as f:
            f.write(data)
        return Response({"upload_id": upload_id, "received": index + 1, "total": total, "bytes": have + len(data)})
