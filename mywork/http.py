"""Request helpers shared by the website's apps."""

from django.utils.http import url_has_allowed_host_and_scheme


def safe_next(request, fallback):
    """Return the requested destination only when it belongs to this site."""
    target = request.POST.get("next") or request.GET.get("next") or ""
    if target and url_has_allowed_host_and_scheme(
        target, allowed_hosts={request.get_host()}, require_https=request.is_secure()
    ):
        return target
    return fallback
