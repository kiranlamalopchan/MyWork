"""Request correlation without putting credentials or personal request bodies in logs."""
import json
import logging
import re
import traceback
import uuid

from django.utils.deprecation import MiddlewareMixin

log = logging.getLogger(__name__)
VALID_ID = re.compile(r"^[A-Za-z0-9_-]{8,80}$")


class RequestIDMiddleware(MiddlewareMixin):
    def process_request(self, request):
        candidate = request.headers.get("X-Request-ID", "")
        request.request_id = candidate if VALID_ID.fullmatch(candidate) else uuid.uuid4().hex

    def process_response(self, request, response):
        response["X-Request-ID"] = getattr(request, "request_id", uuid.uuid4().hex)
        return response


def report_exception(exc, request):
    # Frame names and line numbers locate a fault without logging exception
    # values (which may contain a private message, payslip or credential).
    frames = traceback.extract_tb(exc.__traceback__)[-8:]
    log.error(json.dumps({
        "kind": "server", "name": type(exc).__name__, "message": "Unhandled API error",
        "status": 500, "request": {"method": request.method, "path": request.path,
                                    "id": getattr(request, "request_id", "")},
        "stack": [{"file": frame.filename.rsplit("/", 1)[-1], "line": frame.lineno, "function": frame.name} for frame in frames],
        "app": "KaamKoRecord", "platform": "server",
    }))
