"""
/api/v1/ — the site as data, for the native app.

One URL per thing the app does; the views wrap the same models, forms and
notify calls the pages use. Tokens from auth/login/ or auth/register/ go in
an `Authorization: Token …` header on everything else.
"""

from django.urls import path

from .views import auth, board, friends, holidays, home, me, moderation, notifications, plu, stories, timeclock, uploads

app_name = "api"

urlpatterns = [
    path("auth/login/", auth.Login.as_view(), name="login"),
    path("auth/register/", auth.Register.as_view(), name="register"),
    path("auth/logout/", auth.Logout.as_view(), name="logout"),

    path("me/", me.Me.as_view(), name="me"),
    path("me/activity/", me.Activity.as_view(), name="activity"),
    path("me/password/", me.Password.as_view(), name="me_password"),
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
    path("people/<str:username>/block/", moderation.BlockPerson.as_view(), name="person_block"),
    path("me/blocked/", moderation.Blocked.as_view(), name="me_blocked"),
    path("report/", moderation.ReportThing.as_view(), name="report"),

    path("friends/", friends.Friends.as_view(), name="friends"),
    path("friends/request/<str:username>/", friends.FriendRequestSend.as_view(), name="friend_request_send"),
    path("friends/accept/<int:pk>/", friends.FriendRequestAccept.as_view(), name="friend_request_accept"),
    path("friends/decline/<int:pk>/", friends.FriendRequestDecline.as_view(), name="friend_request_decline"),
    path("friends/remove/<str:username>/", friends.FriendRemove.as_view(), name="friend_remove"),

    path("uploads/", uploads.Upload.as_view(), name="uploads"),
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
    path("plu/import/", plu.Import.as_view(), name="plu_import"),
    path("plu/photo/", plu.Photo.as_view(), name="plu_photo"),
    path("plu/photo/pdf/", plu.PhotoPdf.as_view(), name="plu_photo_pdf"),
    path("plu/<int:plu_no>/", plu.Detail.as_view(), name="plu_item"),

    path("holidays/next/", holidays.Next.as_view(), name="holidays_next"),
    path("holidays/upcoming/", holidays.Upcoming.as_view(), name="holidays_upcoming"),

    # ---- TimeSheet ------------------------------------------------------------
    path("timesheet/clock/", timeclock.Clock.as_view(), name="clock"),
    path("timesheet/clock-in/", timeclock.ClockIn.as_view(), name="clock_in"),
    path("timesheet/break/start/", timeclock.StartBreak.as_view(), name="start_break"),
    path("timesheet/break/end/", timeclock.EndBreak.as_view(), name="end_break"),
    path("timesheet/clock-out/", timeclock.ClockOut.as_view(), name="clock_out"),
    path("timesheet/", timeclock.Timesheet.as_view(), name="timesheet"),
    path("timesheet/calendar/", timeclock.Calendar.as_view(), name="calendar"),
    path("timesheet/shifts/", timeclock.Shifts.as_view(), name="shifts"),
    path("timesheet/shifts/new/", timeclock.NewShift.as_view(), name="shift_new"),
    path("timesheet/shifts/<int:pk>/", timeclock.ShiftDetail.as_view(), name="shift"),
    path("timesheet/workplaces/", timeclock.Workplaces.as_view(), name="workplaces"),
    path("timesheet/workplaces/payslip/", timeclock.Payslip.as_view(), name="payslip"),
    path("timesheet/workplaces/<int:pk>/", timeclock.WorkplaceDetail.as_view(), name="workplace"),
    path("timesheet/workplaces/<int:pk>/removal/", timeclock.WorkplaceRemoval.as_view(), name="workplace_removal"),
    path("timesheet/workplaces/<int:pk>/default/", timeclock.WorkplaceDefault.as_view(), name="workplace_default"),
    path("timesheet/preferences/", timeclock.Preferences.as_view(), name="preferences"),
    path("timesheet/pay/", timeclock.Pay.as_view(), name="pay"),
    path("timesheet/pay/<int:pk>/received/", timeclock.PaymentRecord.as_view(), name="payment_record"),
    path("timesheet/pay/<int:pk>/undo/", timeclock.PaymentUndo.as_view(), name="payment_undo"),
    path("timesheet/more/", timeclock.More.as_view(), name="more"),
    path("timesheet/statement/", timeclock.Statement.as_view(), name="statement"),
]
