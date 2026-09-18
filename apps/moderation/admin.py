from django.contrib import admin, messages
from django.utils import timezone

from .models import Block, Report


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ("created_at", "kind", "target_id", "accused", "reason", "reporter", "handled_at")
    list_filter = ("kind", "reason", ("handled_at", admin.EmptyFieldListFilter))
    search_fields = ("excerpt", "note", "reporter__username", "accused__username")
    readonly_fields = ("reporter", "kind", "target_id", "accused", "reason", "note", "excerpt", "created_at")
    actions = ("mark_handled", "take_down")

    @admin.action(description="Mark as handled")
    def mark_handled(self, request, queryset):
        n = queryset.filter(handled_at__isnull=True).update(handled_at=timezone.now())
        self.message_user(request, f"{n} report{'s' if n != 1 else ''} marked handled.", messages.SUCCESS)

    @admin.action(description="Take the reported thing down")
    def take_down(self, request, queryset):
        from apps.noticeboard.models import Comment, Notice
        from apps.stories.models import Story
        model = {"notice": Notice, "comment": Comment, "story": Story}
        removed = 0
        for report in queryset:
            cls = model.get(report.kind)
            if cls is None:
                continue
            target = cls.objects.filter(pk=report.target_id).first()
            if target is not None:
                target.delete()
                removed += 1
            report.handled_at = timezone.now()
            report.save(update_fields=["handled_at"])
        self.message_user(request, f"{removed} thing{'s' if removed != 1 else ''} taken down.", messages.SUCCESS)


@admin.register(Block)
class BlockAdmin(admin.ModelAdmin):
    list_display = ("blocker", "blocked", "created_at")
    search_fields = ("blocker__username", "blocked__username")
