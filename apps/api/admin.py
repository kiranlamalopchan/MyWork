from django.contrib import admin
from django.contrib.auth import get_user_model
from django.utils import timezone
from apps.notifications.models import Kind
from apps.notifications.notify import notify_many
from .models import MobileRelease, SupportReport


@admin.register(SupportReport)
class SupportReportAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'platform', 'app_version', 'created_at', 'resolved')
    list_filter = ('resolved', 'platform')
    readonly_fields = ('user', 'description', 'screenshot', 'app_version', 'build', 'platform', 'created_at')
    def has_add_permission(self, request):
        return False


@admin.register(MobileRelease)
class MobileReleaseAdmin(admin.ModelAdmin):
    list_display = ('version', 'created_at', 'announced_at')
    readonly_fields = ('created_at', 'announced_at')
    actions = ('announce',)

    @admin.action(description='Send update notification for the selected release')
    def announce(self, request, queryset):
        for release in queryset:
            notify_many(get_user_model().objects.filter(is_active=True), Kind.NOTICE, release.title,
                body=release.message, url='/app-update/', dedupe_key=f'mobile-update:{release.version}')
            release.announced_at = timezone.now()
            release.save(update_fields=['announced_at'])
        self.message_user(request, 'Update announcements have been created; push delivery is attempted for subscribed devices.')
