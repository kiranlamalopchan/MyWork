# mywork/urls.py
#
# KaamKoRecord is the mother project. It owns the hub and the account pages; each
# app is mounted under its own prefix so the two never collide and either one
# can be moved or removed without touching the other.

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import include, path
from django.views.generic import TemplateView

from apps.accounts import views as accounts_views

from . import media_serve, views

urlpatterns = [
    path("admin/", admin.site.urls),

    # Hub + accounts
    path("", views.home, name="home"),
    path("login/", auth_views.LoginView.as_view(template_name="registration/login.html"), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("register/", views.register, name="register"),

    # Getting back in with no password at all. There is no "email me a link"
    # step in front of these — this site cannot send mail and most accounts
    # have no address (apps/accounts/passwords.py) — so the only way here is
    # a link an admin made on /profile/reset-links/ and handed over.
    path("reset/<uidb64>/<token>/", accounts_views.ResetConfirm.as_view(), name="password_reset_confirm"),
    path(
        "reset/done/",
        auth_views.PasswordResetCompleteView.as_view(
            template_name="registration/password_reset_complete.html"
        ),
        name="password_reset_complete",
    ),
    path("privacy/", views.privacy, name="privacy"),
    # Blocking people and reporting posts, and the rules they enforce.
    path("safety/", include("apps.moderation.urls")),
    # Your photo and your name — one level up from either app, because they
    # are true of you across the whole of KaamKoRecord.
    path("profile/", include("apps.accounts.urls")),

    # The shared notice board behind the hub
    path("notices/", include("apps.noticeboard.urls")),

    # The row of stories above it.
    path("stories/", include("apps.stories.urls")),

    # The bell in the app bar, and what is behind it.
    path("notifications/", include("apps.notifications.urls")),

    # Public holidays: the calendar behind the hub's card, and the JSON the
    # mobile app asks for the next one.
    path("holidays/", include("apps.holidays.urls")),

    # The service worker, served from the root and not from /static/.
    #
    # A worker may only control pages below the path it was served from, so
    # one delivered as a static file at /static/js/sw.js would control
    # /static/js/ and nothing else — a push for the board would arrive with
    # nobody listening. It is a template rather than a file so that the icon
    # URLs inside it are the hashed ones in production.
    path(
        "sw.js",
        TemplateView.as_view(
            template_name="sw.js",
            content_type="application/javascript",
        ),
        name="service_worker",
    ),

    # The two apps
    path("plu/", include("apps.plu.urls")),
    path("timesheet/", include("apps.timeclock.urls")),

    # The JSON API for the native app (mobile/): the same things, as data.
    path("api/v1/", include("apps.api.urls")),
]

# Uploaded profile photos and story videos. In production the web server
# serves MEDIA_ROOT directly; this is only so they load while running
# `manage.py runserver` — with Range support, which a story video's iOS
# playback depends on (see media_serve.py).
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, view=media_serve.serve, document_root=settings.MEDIA_ROOT)
