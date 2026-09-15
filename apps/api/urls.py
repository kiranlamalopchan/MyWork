"""
/api/v1/ — the site as data, for the native app.

One URL per thing the app does; the views wrap the same models, forms and
notify calls the pages use. Tokens from auth/login/ or auth/register/ go in
an `Authorization: Token …` header on everything else.
"""

from django.urls import path

from .views import auth, board, holidays, home, me, notifications, plu, stories

app_name = "api"

urlpatterns = [
    path("auth/login/", auth.Login.as_view(), name="login"),
    path("auth/register/", auth.Register.as_view(), name="register"),
    path("auth/logout/", auth.Logout.as_view(), name="logout"),

    path("me/", me.Me.as_view(), name="me"),
    path("me/photo/", me.Photo.as_view(), name="me_photo"),
    path("me/holiday-state/", me.HolidayState.as_view(), name="me_holiday_state"),
    path("devices/", me.Devices.as_view(), name="devices"),

    path("home/", home.Home.as_view(), name="home"),

    path("notices/", board.Notices.as_view(), name="notices"),
    path("notices/<int:pk>/", board.NoticeDetail.as_view(), name="notice"),
    path("notices/<int:pk>/react/", board.NoticeReact.as_view(), name="notice_react"),
    path("notices/<int:pk>/reactions/", board.NoticeReactors.as_view(), name="notice_reactors"),
    path("notices/<int:pk>/comments/", board.Comments.as_view(), name="comments"),
    path("comments/<int:pk>/", board.CommentDetail.as_view(), name="comment"),
    path("comments/<int:pk>/react/", board.CommentReact.as_view(), name="comment_react"),
    path("comments/<int:pk>/reactions/", board.CommentReactors.as_view(), name="comment_reactors"),
    path("people/<str:username>/", board.Person.as_view(), name="person"),

    path("stories/", stories.Tray.as_view(), name="stories"),
    path("stories/<int:pk>/", stories.StoryDetail.as_view(), name="story"),
    path("stories/<int:pk>/seen/", stories.Seen.as_view(), name="story_seen"),
    path("stories/<int:pk>/react/", stories.React.as_view(), name="story_react"),
    path("stories/<str:username>/", stories.Person.as_view(), name="story_person"),

    path("notifications/", notifications.Inbox.as_view(), name="notifications"),
    path("notifications/unread/", notifications.Unread.as_view(), name="notifications_unread"),
    path("notifications/read/", notifications.ReadAll.as_view(), name="notifications_read"),
    path("notifications/<int:pk>/read/", notifications.Read.as_view(), name="notification_read"),

    path("plu/search/", plu.Search.as_view(), name="plu_search"),
    path("plu/<int:plu_no>/", plu.Detail.as_view(), name="plu_item"),

    path("holidays/next/", holidays.Next.as_view(), name="holidays_next"),
    path("holidays/upcoming/", holidays.Upcoming.as_view(), name="holidays_upcoming"),
]
