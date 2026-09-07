from django.contrib import admin

from .models import Comment, CommentReaction, Notice, Reaction


class ReactionInline(admin.TabularInline):
    """Who reacted, shown against the thing they reacted to."""

    model = Reaction
    extra = 0
    readonly_fields = ("created_at",)


class CommentInline(admin.TabularInline):
    model = Comment
    extra = 0
    fields = ("author", "parent", "body", "created_at")
    readonly_fields = ("created_at",)


@admin.register(Notice)
class NoticeAdmin(admin.ModelAdmin):
    list_display = ("author", "created_at", "body")
    list_filter = ("created_at",)
    search_fields = ("author__username", "body")
    date_hierarchy = "created_at"
    inlines = [ReactionInline, CommentInline]


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ("author", "notice", "parent", "created_at", "body")
    list_filter = ("created_at",)
    search_fields = ("author__username", "body")


@admin.register(Reaction)
class ReactionAdmin(admin.ModelAdmin):
    list_display = ("user", "emoji", "notice", "created_at")
    list_filter = ("emoji",)


@admin.register(CommentReaction)
class CommentReactionAdmin(admin.ModelAdmin):
    list_display = ("user", "emoji", "comment", "created_at")
    list_filter = ("emoji",)
