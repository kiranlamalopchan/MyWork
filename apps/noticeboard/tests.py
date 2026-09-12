"""
The board's one rule: everybody reads everything, nobody edits anyone else's.
"""

from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import (
    MAX_BODY, MAX_COMMENT, Comment, CommentReaction, Emoji, Notice, Reaction,
)
from .views import COMMENTS_SHOWN, REPLIES_SHOWN, _fold


class NoticeBoardTests(TestCase):
    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.theirs = Notice.objects.create(author=self.sam, body="Fridge is fixed.")
        self.client.force_login(self.kiran)

    # ---- reading is shared ---------------------------------------------

    def test_everyone_sees_every_notice(self):
        Notice.objects.create(author=self.kiran, body="Swapping Friday.")

        for page in [reverse("home"), reverse("notices:board")]:
            with self.subTest(page=page):
                resp = self.client.get(page)
                self.assertContains(resp, "Fridge is fixed.")
                self.assertContains(resp, "Swapping Friday.")

    def test_the_board_needs_a_login(self):
        self.client.logout()
        resp = self.client.get(reverse("notices:board"))
        self.assertEqual(resp.status_code, 302)
        self.assertIn("/login/", resp["Location"])

    # ---- posting --------------------------------------------------------

    def test_posting_lands_back_where_it_was_written(self):
        resp = self.client.post(
            reverse("notices:create"), {"body": "  Coffee machine is out.  ", "next": "/"}
        )
        self.assertRedirects(resp, "/")

        notice = Notice.objects.get(author=self.kiran)
        # Whitespace either side is trimmed, so the board doesn't hold blanks.
        self.assertEqual(notice.body, "Coffee machine is out.")

    def test_an_empty_notice_is_refused_without_losing_the_page(self):
        resp = self.client.post(reverse("notices:create"), {"body": "   ", "next": "/"})
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Write something before posting")
        self.assertFalse(Notice.objects.filter(author=self.kiran).exists())

    def test_a_rejected_post_keeps_the_page_it_came_from(self):
        resp = self.client.post(reverse("notices:create"), {"body": "", "next": "/"})
        # Not the create URL, which is POST-only and would 405 on the retry.
        self.assertContains(resp, 'name="next" value="/"')
        # And the dialog is marked to re-open, so the error reaches the writer
        # where they typed rather than on an empty board.
        self.assertContains(resp, "data-open")

    def test_the_composer_is_a_dialog_behind_the_plus_button(self):
        resp = self.client.get(reverse("notices:board"))
        html = resp.content.decode()
        # Closed by default: no data-open, and the + is a real link to the
        # full-page composer for anyone without JavaScript.
        self.assertIn('id="compose-modal"', html)
        self.assertNotIn("data-open", html)
        self.assertIn(reverse("notices:compose"), html)

    def test_the_plus_cannot_smuggle_an_off_site_return(self):
        resp = self.client.get(reverse("notices:compose"), {"next": "https://evil.example/"})
        self.assertNotContains(resp, "evil.example")

    def test_the_plus_falls_back_to_a_real_page(self):
        resp = self.client.get(reverse("notices:compose"))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "New notice")
        self.assertContains(resp, reverse("notices:create"))

    def test_a_notice_longer_than_the_limit_is_refused(self):
        resp = self.client.post(
            reverse("notices:create"), {"body": "x" * (MAX_BODY + 1), "next": "/"}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Notice.objects.filter(author=self.kiran).exists())

    def test_a_redirect_off_this_host_is_ignored(self):
        resp = self.client.post(
            reverse("notices:create"), {"body": "Hello", "next": "https://evil.example/"}
        )
        self.assertRedirects(resp, reverse("notices:board"))

    # ---- your own, and only your own ------------------------------------

    def test_you_can_edit_and_remove_your_own(self):
        mine = Notice.objects.create(author=self.kiran, body="Original")

        resp = self.client.post(
            reverse("notices:edit", args=[mine.pk]), {"body": "Corrected", "next": "/"}
        )
        self.assertRedirects(resp, "/")
        mine.refresh_from_db()
        self.assertEqual(mine.body, "Corrected")

        resp = self.client.post(reverse("notices:delete", args=[mine.pk]), {"next": "/"})
        self.assertRedirects(resp, "/")
        self.assertFalse(Notice.objects.filter(pk=mine.pk).exists())

    def test_an_edit_sent_by_fetch_is_answered_with_the_words_redrawn(self):
        mine = Notice.objects.create(author=self.kiran, body="Typo hear")
        resp = self.client.post(
            reverse("notices:edit", args=[mine.pk]), {"body": "Typo here", "next": "/"},
            HTTP_X_REQUESTED_WITH="fetch",
        )
        self.assertEqual(resp.status_code, 200)
        mine.refresh_from_db()
        self.assertEqual(mine.body, "Typo here")
        body = resp.json()["body"]
        # The block the card shows, with the new words and the editor
        # folded back inside it for next time.
        self.assertIn('class="notice__body"', body)
        self.assertIn("Typo here", body)
        self.assertIn("data-editor", body)

    def test_an_empty_edit_sent_by_fetch_is_refused_with_the_reason(self):
        mine = Notice.objects.create(author=self.kiran, body="Keep me")
        resp = self.client.post(
            reverse("notices:edit", args=[mine.pk]), {"body": "   ", "next": "/"},
            HTTP_X_REQUESTED_WITH="fetch",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Write something", resp.json()["error"])
        mine.refresh_from_db()
        self.assertEqual(mine.body, "Keep me")

    def test_your_own_notice_carries_the_editor_and_nobody_elses_does(self):
        mine = Notice.objects.create(author=self.kiran, body="Mine")
        html = self.client.get(reverse("notices:board")).content.decode()
        # One editor on the page — yours — and it starts folded away.
        self.assertEqual(html.count('class="editor"'), 1)
        self.assertEqual(html.count("data-editor hidden"), 1)
        self.assertIn(reverse("notices:edit", args=[mine.pk]), html)
        self.assertNotIn(reverse("notices:edit", args=[self.theirs.pk]), html)

    def test_someone_elses_notice_cannot_be_edited(self):
        for method, url in [
            ("get", reverse("notices:edit", args=[self.theirs.pk])),
            ("post", reverse("notices:edit", args=[self.theirs.pk])),
            ("post", reverse("notices:delete", args=[self.theirs.pk])),
        ]:
            with self.subTest(url=url, method=method):
                resp = getattr(self.client, method)(url, {"body": "Hijacked"})
                # Not theirs to change, and the board doesn't confirm the id
                # exists by answering 403 instead.
                self.assertEqual(resp.status_code, 404)

        self.theirs.refresh_from_db()
        self.assertEqual(self.theirs.body, "Fridge is fixed.")

    def test_only_your_own_notices_offer_edit_and_remove(self):
        Notice.objects.create(author=self.kiran, body="Mine to change")
        html = self.client.get(reverse("notices:board")).content.decode()

        # One set of buttons: the one on your own notice.
        self.assertEqual(html.count('class="act act--quiet"'), 1)
        self.assertNotIn(reverse("notices:edit", args=[self.theirs.pk]), html)
        self.assertIn("You", html)

    def test_an_author_going_away_takes_their_notices_with_them(self):
        self.sam.delete()
        self.assertFalse(Notice.objects.filter(pk=self.theirs.pk).exists())

    # ---- presentation ---------------------------------------------------

    def test_each_author_keeps_one_colour(self):
        again = Notice.objects.create(author=self.sam, body="Second one")
        self.assertEqual(again.hue, self.theirs.hue)
        self.assertEqual(self.theirs.initial, "S")
        self.assertNotEqual(
            Notice(author=self.kiran, body="x").hue, self.theirs.hue
        )


class ReactionTests(TestCase):
    """
    Emoji are for everyone's notices, not just your own — but one per person,
    and taking one back is the same tap that left it.
    """

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.notice = Notice.objects.create(author=self.sam, body="Fridge is fixed.")
        self.client.force_login(self.kiran)
        self.url = reverse("notices:react", args=[self.notice.pk])

    def test_you_can_react_to_someone_elses_notice(self):
        resp = self.client.post(self.url, {"emoji": Reaction.Emoji.LOVE, "next": "/"})
        # Back to the notice you were reading, not the top of the board.
        self.assertRedirects(resp, f"/#notice-{self.notice.pk}")

        reaction = Reaction.objects.get(notice=self.notice, user=self.kiran)
        self.assertEqual(reaction.emoji, Reaction.Emoji.LOVE)

    def test_the_same_emoji_again_takes_it_back(self):
        self.client.post(self.url, {"emoji": Reaction.Emoji.LIKE, "next": "/"})
        self.client.post(self.url, {"emoji": Reaction.Emoji.LIKE, "next": "/"})
        self.assertFalse(Reaction.objects.filter(notice=self.notice).exists())

    def test_a_different_emoji_replaces_it(self):
        self.client.post(self.url, {"emoji": Reaction.Emoji.LIKE, "next": "/"})
        self.client.post(self.url, {"emoji": Reaction.Emoji.ANGRY, "next": "/"})

        reactions = Reaction.objects.filter(notice=self.notice, user=self.kiran)
        self.assertEqual(reactions.count(), 1)
        self.assertEqual(reactions.first().emoji, Reaction.Emoji.ANGRY)

    def test_an_emoji_that_is_not_on_the_menu_is_ignored(self):
        self.client.post(self.url, {"emoji": "\U0001F4A3", "next": "/"})
        self.assertFalse(Reaction.objects.exists())

    def test_everyone_reacts_separately_and_the_tally_adds_up(self):
        Reaction.objects.create(notice=self.notice, user=self.sam, emoji=Reaction.Emoji.LIKE)
        self.client.post(self.url, {"emoji": Reaction.Emoji.LIKE, "next": "/"})

        notice = Notice.visible().get(pk=self.notice.pk)
        self.assertEqual(notice.reaction_groups(), [(Reaction.Emoji.LIKE, 2)])
        self.assertEqual(notice.emoji_of(self.kiran), Reaction.Emoji.LIKE)

    def test_the_board_shows_the_emoji_you_left(self):
        self.client.post(self.url, {"emoji": Reaction.Emoji.WOW, "next": "/"})
        resp = self.client.get(reverse("notices:board"))
        # The button wears the face and says which: "Wow", not "Reacted".
        self.assertContains(resp, 'data-kind="wow"')
        self.assertContains(resp, '<span class="act__label">Wow</span>', html=False)

    def test_the_faces_are_drawn_rather_than_typed(self):
        Reaction.objects.create(notice=self.notice, user=self.sam, emoji=Reaction.Emoji.LIKE)
        html = self.client.get(reverse("notices:board")).content.decode()
        # Every face on the menu is an icon in the picker, and the tally
        # carries the one that was left.
        for value in Emoji.values:
            self.assertIn(f'value="{value}"', html)
        self.assertIn('class="rx rx--like"', html)
        self.assertNotIn(">\U0001F44D<", html)

    # ---- by fetch: what app.js sends, and what it is handed back ----------

    def react_by_fetch(self, emoji):
        return self.client.post(
            self.url, {"emoji": emoji, "next": "/"}, HTTP_X_REQUESTED_WITH="fetch"
        )

    def test_a_tap_sent_by_fetch_is_answered_in_place(self):
        resp = self.react_by_fetch(Reaction.Emoji.LOVE)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "application/json")

        data = resp.json()
        self.assertEqual(data["key"], f"notice-{self.notice.pk}")
        self.assertEqual(data["emoji"], Reaction.Emoji.LOVE)
        # The control comes back wearing the face, ready to drop in.
        self.assertIn(f'data-react="notice-{self.notice.pk}"', data["control"])
        self.assertIn('data-kind="love"', data["control"])
        self.assertIn("Love", data["control"])
        # And the tally counts it, with "You" first.
        self.assertIn(f'data-tally="notice-{self.notice.pk}"', data["tally"])
        self.assertIn("rx--love", data["tally"])
        self.assertIn("You", data["tally"])
        self.assertNotIn(f'data-tally="notice-{self.notice.pk}" hidden', data["tally"])

    def test_taking_it_back_by_fetch_empties_the_tally(self):
        self.react_by_fetch(Reaction.Emoji.LIKE)
        data = self.react_by_fetch(Reaction.Emoji.LIKE).json()

        self.assertIsNone(data["emoji"])
        self.assertNotIn("is-on", data["control"])
        self.assertIn("React", data["control"])
        # Nothing left to say, so the tally is handed back hidden.
        self.assertIn(f'data-tally="notice-{self.notice.pk}" hidden', data["tally"])
        self.assertFalse(Reaction.objects.exists())

    def test_the_fetched_tally_still_counts_the_comments(self):
        Comment.objects.create(notice=self.notice, author=self.sam, body="Good.")
        data = self.react_by_fetch(Reaction.Emoji.HAHA).json()
        self.assertIn("1 comment", data["tally"])


class CommentTests(TestCase):
    """Anyone may reply to anyone; only your own reply is yours to delete."""

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.notice = Notice.objects.create(author=self.sam, body="Fridge is fixed.")
        self.client.force_login(self.kiran)
        self.url = reverse("notices:comment", args=[self.notice.pk])

    def test_you_can_reply_to_someone_elses_notice(self):
        resp = self.client.post(self.url, {"body": "Thanks for sorting it.", "next": "/"})

        comment = Comment.objects.get(notice=self.notice)
        # Back to what you just wrote, which in a long thread is not where the
        # notice starts.
        self.assertRedirects(resp, f"/#comment-{comment.pk}")

        self.assertEqual(comment.author, self.kiran)
        self.assertEqual(comment.body, "Thanks for sorting it.")

    def test_an_empty_reply_is_not_saved(self):
        self.client.post(self.url, {"body": "   ", "next": "/"})
        self.assertFalse(Comment.objects.exists())

    def test_a_reply_past_the_limit_is_not_saved(self):
        self.client.post(self.url, {"body": "x" * (MAX_COMMENT + 1), "next": "/"})
        self.assertFalse(Comment.objects.exists())

    def test_you_can_delete_your_own_reply(self):
        mine = Comment.objects.create(notice=self.notice, author=self.kiran, body="Mine")
        resp = self.client.post(
            reverse("notices:comment_delete", args=[mine.pk]), {"next": "/"}
        )
        self.assertRedirects(resp, f"/#notice-{self.notice.pk}")
        self.assertFalse(Comment.objects.filter(pk=mine.pk).exists())

    def test_you_cannot_delete_anyone_elses_reply(self):
        theirs = Comment.objects.create(notice=self.notice, author=self.sam, body="Theirs")

        resp = self.client.post(
            reverse("notices:comment_delete", args=[theirs.pk]), {"next": "/"}
        )
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(Comment.objects.filter(pk=theirs.pk).exists())

    def test_the_notice_author_cannot_delete_replies_on_their_own_notice(self):
        # Owning the notice is not owning what people said under it.
        mine_on_theirs = Comment.objects.create(
            notice=self.notice, author=self.kiran, body="Mine"
        )
        self.client.force_login(self.sam)

        resp = self.client.post(
            reverse("notices:comment_delete", args=[mine_on_theirs.pk]), {"next": "/"}
        )
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(Comment.objects.filter(pk=mine_on_theirs.pk).exists())

    def test_only_your_own_replies_offer_delete(self):
        Comment.objects.create(notice=self.notice, author=self.sam, body="Theirs")
        mine = Comment.objects.create(notice=self.notice, author=self.kiran, body="Mine")

        html = self.client.get(reverse("notices:board")).content.decode()
        self.assertEqual(html.count('class="comment__del"'), 1)
        self.assertIn(reverse("notices:comment_delete", args=[mine.pk]), html)

    def test_replies_go_with_the_notice_they_sit_under(self):
        Comment.objects.create(notice=self.notice, author=self.kiran, body="Mine")
        self.notice.delete()
        self.assertFalse(Comment.objects.exists())


class ReplyTests(TestCase):
    """
    A reply answers a comment, and the thread stops one level down: an answer
    to a reply joins that reply's thread rather than starting a deeper one.
    """

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.notice = Notice.objects.create(author=self.sam, body="Fridge is fixed.")
        self.comment = Comment.objects.create(
            notice=self.notice, author=self.sam, body="About time."
        )
        self.client.force_login(self.kiran)
        self.url = reverse("notices:comment", args=[self.notice.pk])

    def test_a_reply_hangs_off_the_comment_it_answers(self):
        resp = self.client.post(
            self.url, {"body": "Ha.", "parent": self.comment.pk, "next": "/"}
        )
        reply = Comment.objects.get(body="Ha.")
        self.assertEqual(reply.parent, self.comment)
        self.assertTrue(reply.is_reply)
        # And you land on the reply, not the top of the notice.
        self.assertRedirects(resp, f"/#comment-{reply.pk}")

    def test_answering_a_reply_joins_that_thread_rather_than_nesting_deeper(self):
        reply = Comment.objects.create(
            notice=self.notice, author=self.kiran, body="Ha.", parent=self.comment
        )
        self.client.post(self.url, {"body": "Same.", "parent": reply.pk, "next": "/"})

        self.assertEqual(Comment.objects.get(body="Same.").parent, self.comment)

    def test_a_reply_cannot_be_hung_on_another_notice_s_comment(self):
        elsewhere = Notice.objects.create(author=self.sam, body="Other wall")
        theirs = Comment.objects.create(
            notice=elsewhere, author=self.sam, body="Elsewhere"
        )

        self.client.post(self.url, {"body": "Smuggled.", "parent": theirs.pk, "next": "/"})

        smuggled = Comment.objects.get(body="Smuggled.")
        # It stays where it was written: a top-level comment on this notice.
        self.assertEqual(smuggled.notice, self.notice)
        self.assertIsNone(smuggled.parent)

    def test_a_parent_that_is_not_a_number_is_simply_a_comment(self):
        self.client.post(self.url, {"body": "Plain.", "parent": "nonsense", "next": "/"})
        self.assertIsNone(Comment.objects.get(body="Plain.").parent)

    def test_deleting_a_comment_takes_its_replies_with_it(self):
        mine = Comment.objects.create(notice=self.notice, author=self.kiran, body="Mine")
        Comment.objects.create(
            notice=self.notice, author=self.sam, body="Answering", parent=mine
        )

        self.client.post(reverse("notices:comment_delete", args=[mine.pk]), {"next": "/"})
        self.assertFalse(Comment.objects.filter(body="Answering").exists())

    def test_the_thread_nests_replies_under_the_comment_they_answer(self):
        reply = Comment.objects.create(
            notice=self.notice, author=self.kiran, body="Ha.", parent=self.comment
        )
        other = Comment.objects.create(
            notice=self.notice, author=self.kiran, body="Second comment"
        )

        thread = Notice.visible().get(pk=self.notice.pk).thread()
        self.assertEqual([c.pk for c in thread], [self.comment.pk, other.pk])
        self.assertEqual([c.pk for c in thread[0].reply_list], [reply.pk])
        self.assertEqual(thread[1].reply_list, [])

    def test_the_count_under_a_notice_includes_replies(self):
        Comment.objects.create(
            notice=self.notice, author=self.kiran, body="Ha.", parent=self.comment
        )
        self.assertEqual(Notice.visible().get(pk=self.notice.pk).comment_total(), 2)

    def test_the_board_shows_a_reply_under_its_comment(self):
        Comment.objects.create(
            notice=self.notice, author=self.kiran, body="Nested answer", parent=self.comment
        )
        html = self.client.get(reverse("notices:board")).content.decode()

        self.assertIn("Nested answer", html)
        self.assertIn('class="replies"', html)


class CommentReactionTests(TestCase):
    """A comment takes the same faces a notice does, under the same rules."""

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.notice = Notice.objects.create(author=self.sam, body="Fridge is fixed.")
        self.comment = Comment.objects.create(
            notice=self.notice, author=self.sam, body="About time."
        )
        self.client.force_login(self.kiran)
        self.url = reverse("notices:comment_react", args=[self.comment.pk])

    def test_you_can_react_to_a_comment(self):
        resp = self.client.post(self.url, {"emoji": CommentReaction.Emoji.LIKE, "next": "/"})
        # Back at the comment you reacted to.
        self.assertRedirects(resp, f"/#comment-{self.comment.pk}")
        self.assertEqual(
            CommentReaction.objects.get(comment=self.comment, user=self.kiran).emoji,
            CommentReaction.Emoji.LIKE,
        )

    def test_the_same_emoji_again_takes_it_back(self):
        self.client.post(self.url, {"emoji": CommentReaction.Emoji.LIKE, "next": "/"})
        self.client.post(self.url, {"emoji": CommentReaction.Emoji.LIKE, "next": "/"})
        self.assertFalse(CommentReaction.objects.exists())

    def test_a_different_emoji_replaces_it(self):
        self.client.post(self.url, {"emoji": CommentReaction.Emoji.LIKE, "next": "/"})
        self.client.post(self.url, {"emoji": CommentReaction.Emoji.WOW, "next": "/"})

        mine = CommentReaction.objects.get(comment=self.comment, user=self.kiran)
        self.assertEqual(mine.emoji, CommentReaction.Emoji.WOW)

    def test_an_emoji_that_is_not_on_the_menu_leaves_yours_alone(self):
        self.client.post(self.url, {"emoji": CommentReaction.Emoji.SAD, "next": "/"})
        self.client.post(self.url, {"emoji": "\U0001F4A3", "next": "/"})

        self.assertEqual(
            CommentReaction.objects.get(user=self.kiran).emoji, CommentReaction.Emoji.SAD
        )

    def test_reacting_to_a_comment_leaves_the_notice_alone(self):
        self.client.post(self.url, {"emoji": CommentReaction.Emoji.LIKE, "next": "/"})
        self.assertFalse(Reaction.objects.exists())

    def test_the_tally_and_your_own_emoji_show_on_the_comment(self):
        CommentReaction.objects.create(
            comment=self.comment, user=self.sam, emoji=CommentReaction.Emoji.LIKE
        )
        self.client.post(self.url, {"emoji": CommentReaction.Emoji.LIKE, "next": "/"})

        comment = Comment.objects.prefetch_related("reactions__user").get(pk=self.comment.pk)
        self.assertEqual(comment.reaction_groups(), [(CommentReaction.Emoji.LIKE, 2)])
        self.assertEqual(comment.emoji_of(self.kiran), CommentReaction.Emoji.LIKE)

    def test_a_comment_going_away_takes_its_reactions_with_it(self):
        self.client.post(self.url, {"emoji": CommentReaction.Emoji.LIKE, "next": "/"})
        self.comment.delete()
        self.assertFalse(CommentReaction.objects.exists())

    def test_a_tap_on_a_comment_sent_by_fetch_is_answered_in_place(self):
        resp = self.client.post(
            self.url, {"emoji": CommentReaction.Emoji.CARE, "next": "/"},
            HTTP_X_REQUESTED_WITH="fetch",
        )
        data = resp.json()
        self.assertEqual(data["key"], f"comment-{self.comment.pk}")
        # The comment-sized control and the count on the bubble.
        self.assertIn("picker--sm", data["control"])
        self.assertIn('data-kind="care"', data["control"])
        self.assertIn(f'data-tally="comment-{self.comment.pk}"', data["tally"])
        self.assertIn("rx--care", data["tally"])


class WhoReactedTests(TestCase):
    """The count is a number; the names behind it are the useful part."""

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.ana = User.objects.create_user("ana", password="pw")
        self.dee = User.objects.create_user("dee", password="pw")
        self.notice = Notice.objects.create(author=self.sam, body="Fridge is fixed.")
        self.client.force_login(self.kiran)

    def react(self, *users, emoji=Reaction.Emoji.LIKE):
        for user in users:
            Reaction.objects.create(notice=self.notice, user=user, emoji=emoji)
        return Notice.visible().get(pk=self.notice.pk)

    def test_your_own_reaction_reads_as_you_and_comes_first(self):
        notice = self.react(self.sam, self.kiran)
        self.assertEqual(notice.reactor_names(self.kiran), ["You", "sam"])

    def test_two_names_are_spelled_out(self):
        notice = self.react(self.sam, self.ana)
        self.assertEqual(notice.reactor_summary(self.kiran), "ana and sam")

    def test_a_crowd_is_counted_after_the_first_names(self):
        notice = self.react(self.kiran, self.sam, self.ana, self.dee)
        self.assertEqual(notice.reactor_summary(self.kiran), "You, ana and 2 others")

    def test_one_extra_person_is_one_other(self):
        notice = self.react(self.sam, self.ana, self.dee)
        self.assertEqual(notice.reactor_summary(self.kiran), "ana, dee and 1 other")

    def test_nobody_reacting_says_nothing_at_all(self):
        self.assertEqual(self.react().reactor_summary(self.kiran), "")

    def test_the_board_names_who_reacted(self):
        self.react(self.sam, self.ana)
        html = self.client.get(reverse("notices:board")).content.decode()
        self.assertIn("ana and sam", html)

    def test_the_list_behind_the_tally_can_be_fetched_for_the_sheet(self):
        self.react(self.sam, self.ana)
        self.react(self.kiran, emoji=Reaction.Emoji.LOVE)
        resp = self.client.get(
            reverse("notices:reactors", args=[self.notice.pk]), HTTP_X_REQUESTED_WITH="fetch"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["title"], "3 reactions")
        self.assertIn(self.notice.author.get_username(), data["sub"])
        # The list, without a page around it.
        self.assertIn("reactors__row", data["html"])
        self.assertNotIn("<html", data["html"])
        for name in ["sam", "ana", "kiran"]:
            self.assertIn(name, data["html"])

    def test_the_page_behind_the_tally_lists_everyone_by_emoji(self):
        self.react(self.sam, self.ana)
        self.react(self.kiran, emoji=Reaction.Emoji.LOVE)

        resp = self.client.get(reverse("notices:reactors", args=[self.notice.pk]))
        self.assertContains(resp, "3 reactions")
        for name in ["sam", "ana", "kiran"]:
            self.assertContains(resp, name)

    def test_a_comment_has_the_same_page(self):
        comment = Comment.objects.create(
            notice=self.notice, author=self.sam, body="About time."
        )
        CommentReaction.objects.create(
            comment=comment, user=self.ana, emoji=CommentReaction.Emoji.HAHA
        )

        resp = self.client.get(reverse("notices:comment_reactors", args=[comment.pk]))
        self.assertContains(resp, "1 reaction")
        self.assertContains(resp, "ana")

    def test_who_reacted_needs_a_login(self):
        self.client.logout()
        resp = self.client.get(reverse("notices:reactors", args=[self.notice.pk]))
        self.assertEqual(resp.status_code, 302)


class ProfileTests(TestCase):
    """Every name on the board leads to the person who wrote it."""

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.notice = Notice.objects.create(author=self.sam, body="Fridge is fixed.")
        self.client.force_login(self.kiran)
        self.url = reverse("notices:person", args=["sam"])

    def test_a_profile_shows_the_person_and_what_they_posted(self):
        resp = self.client.get(self.url)
        self.assertContains(resp, "sam")
        self.assertContains(resp, "Fridge is fixed.")

    def test_the_numbers_count_both_sides_of_a_reaction(self):
        comment = Comment.objects.create(
            notice=self.notice, author=self.sam, body="About time."
        )
        # Two reactions to sam's words, one left by sam elsewhere.
        Reaction.objects.create(
            notice=self.notice, user=self.kiran, emoji=Reaction.Emoji.LIKE
        )
        CommentReaction.objects.create(
            comment=comment, user=self.kiran, emoji=CommentReaction.Emoji.LIKE
        )
        mine = Notice.objects.create(author=self.kiran, body="Mine")
        Reaction.objects.create(notice=mine, user=self.sam, emoji=Reaction.Emoji.WOW)

        resp = self.client.get(self.url)
        self.assertEqual(resp.context["received"], 2)
        self.assertEqual(resp.context["given"], 1)
        self.assertEqual(resp.context["profile"].notice_count, 1)
        self.assertEqual(resp.context["profile"].comment_count, 1)

    def test_only_that_person_s_notices_are_on_it(self):
        Notice.objects.create(author=self.kiran, body="Not sam's")
        resp = self.client.get(self.url)
        self.assertNotContains(resp, "Not sam&#x27;s")

    def test_your_own_profile_says_so(self):
        resp = self.client.get(reverse("notices:person", args=["kiran"]))
        self.assertEqual(resp.context["is_me"], True)

    def test_the_board_links_every_author_to_their_profile(self):
        html = self.client.get(reverse("notices:board")).content.decode()
        self.assertIn(self.url, html)

    def test_a_name_nobody_has_is_a_404(self):
        resp = self.client.get(reverse("notices:person", args=["ghost"]))
        self.assertEqual(resp.status_code, 404)

    def test_a_profile_needs_a_login(self):
        self.client.logout()
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 302)


class FoldingTests(TestCase):
    """
    A long thread folds rather than running down the page — and it always
    folds from the top, so whatever was written last is what stays in view.
    """

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.notice = Notice.objects.create(author=self.kiran, body="Fridge is fixed.")
        self.client.force_login(self.kiran)

    def comments(self, n, parent=None):
        return [
            Comment.objects.create(
                notice=self.notice, author=self.kiran, body=f"c{i}", parent=parent
            )
            for i in range(n)
        ]

    def test_the_newest_stay_and_the_rest_fold(self):
        self.assertEqual(_fold(["a", "b", "c", "d"], 2), (["a", "b"], ["c", "d"]))

    def test_a_short_thread_folds_nothing(self):
        self.assertEqual(_fold(["a"], 3), ([], ["a"]))

    def test_a_thread_at_the_limit_stays_open(self):
        self.comments(COMMENTS_SHOWN)
        notice = self.board_notice()
        self.assertEqual(notice.older_comments, [])
        self.assertEqual(len(notice.recent_comments), COMMENTS_SHOWN)

    def test_one_comment_past_the_limit_folds_the_oldest(self):
        made = self.comments(COMMENTS_SHOWN + 1)
        notice = self.board_notice()

        self.assertEqual([c.pk for c in notice.older_comments], [made[0].pk])
        self.assertEqual([c.pk for c in notice.recent_comments], [c.pk for c in made[1:]])

    def test_replies_fold_the_same_way(self):
        parent = self.comments(1)[0]
        replies = self.comments(REPLIES_SHOWN + 1, parent=parent)

        comment = self.board_notice().recent_comments[0]
        self.assertEqual([c.pk for c in comment.older_replies], [replies[0].pk])
        self.assertEqual(len(comment.recent_replies), REPLIES_SHOWN)

    def test_a_folded_comment_is_still_on_the_page_to_be_opened(self):
        self.comments(COMMENTS_SHOWN + 1)
        html = self.client.get(reverse("notices:board")).content.decode()

        # Behind a fold, not dropped: everything is still there to read.
        self.assertIn("View 1 previous comment", html)
        for i in range(COMMENTS_SHOWN + 1):
            self.assertIn(f">c{i}<", html)

    def test_the_comment_you_just_wrote_is_never_behind_the_fold(self):
        self.comments(COMMENTS_SHOWN + 2)
        self.client.post(
            reverse("notices:comment", args=[self.notice.pk]),
            {"body": "Just now", "next": "/"},
        )

        notice = self.board_notice()
        self.assertIn("Just now", [c.body for c in notice.recent_comments])

    def board_notice(self):
        return self.client.get(reverse("notices:board")).context["notices"][0]


class ThreadLayoutTests(TestCase):
    """
    The row of buttons under a notice has to stay one row: the thread it
    opens sits below it rather than inside one of its buttons.
    """

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.notice = Notice.objects.create(author=self.kiran, body="Fridge is fixed.")
        self.client.force_login(self.kiran)
        self.html = self.client.get(reverse("notices:board")).content.decode()

    def test_the_thread_is_not_inside_the_button_row(self):
        self.assertIn('<div class="thread">', self.html)
        self.assertNotIn('<details class="thread"', self.html)

    def test_comment_points_at_the_box_at_the_foot_of_the_thread(self):
        self.assertIn(f'href="#say-{self.notice.pk}"', self.html)
        self.assertIn(f'id="say-{self.notice.pk}"', self.html)

    def test_reply_opens_its_own_box_without_script(self):
        comment = Comment.objects.create(
            notice=self.notice, author=self.kiran, body="Mine"
        )
        html = self.client.get(reverse("notices:board")).content.decode()

        # An ordinary anchor to the form's own id — CSS does the revealing, so
        # replying works with JavaScript off.
        self.assertIn(f'href="#reply-{comment.pk}"', html)
        self.assertIn(f'id="reply-{comment.pk}"', html)


class BoardFoldTests(TestCase):
    """
    The board opens at two notices. The rest are behind one tap — still on the
    page, so opening them costs nothing more.
    """

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.kiran)

    def post(self, n):
        return [
            Notice.objects.create(author=self.kiran, body=f"Notice {i}") for i in range(n)
        ]

    def test_two_notices_are_open_and_the_rest_fold(self):
        self.post(5)
        html = self.client.get(reverse("notices:board")).content.decode()

        self.assertIn("Show 3 more notices", html)
        # Folded, not dropped: every notice is still there to be read.
        for i in range(5):
            self.assertIn(f"Notice {i}", html)

    def test_a_short_board_has_nothing_to_fold(self):
        self.post(2)
        html = self.client.get(reverse("notices:board")).content.decode()
        self.assertNotIn("more notice", html)

    def test_one_extra_notice_reads_as_one(self):
        self.post(3)
        self.assertContains(self.client.get(reverse("notices:board")), "Show 1 more notice")

    def test_the_hub_fetches_two_rather_than_folding_the_rest(self):
        self.post(6)
        resp = self.client.get(reverse("home"))

        # The saving is in what is fetched, not in what is hidden — the hub
        # asks the database for two and points at the board for the rest.
        self.assertEqual(len(resp.context["notices"]), 2)
        self.assertEqual(resp.context["notice_total"], 6)
        self.assertContains(resp, "See all 6 notices")

    def test_the_newest_notices_are_the_open_ones(self):
        made = self.post(4)
        html = self.client.get(reverse("notices:board")).content.decode()

        # Newest first, so the two above the fold are the two most recent.
        fold = html.index("Show 2 more notices")
        for newest in made[-2:]:
            self.assertLess(html.index(newest.body), fold)
        for older in made[:2]:
            self.assertGreater(html.index(older.body), fold)


class NotificationLookTests(TestCase):
    """
    A notice arrives the way a notification does.

    The colour comes off the author's name, the card is dotted while it is
    still new, and what you posted yourself stays plain — it is not news to
    you. All of it is CSS driven by the classes and the hue set here, so this
    is what has to hold for the look to hold.
    """

    def setUp(self):
        self.me = User.objects.create_user("kiran", password="pw")
        self.them = User.objects.create_user("sam", password="pw")
        self.client.force_login(self.me)

    def _post(self, author, body="Roster's up.", days_ago=0):
        notice = Notice.objects.create(author=author, body=body)
        if days_ago:
            Notice.objects.filter(pk=notice.pk).update(
                created_at=timezone.now() - timedelta(days=days_ago)
            )
        return Notice.objects.get(pk=notice.pk)

    def _board(self):
        return self.client.get(reverse("notices:board")).content.decode()

    def test_something_just_posted_reads_as_new(self):
        self.assertTrue(self._post(self.them).is_new)

    def test_something_from_days_ago_does_not(self):
        self.assertFalse(self._post(self.them, days_ago=3).is_new)

    def test_a_notice_from_someone_else_is_tinted_and_dotted(self):
        notice = self._post(self.them)
        html = self._board()

        self.assertIn("notice--from", html)
        self.assertIn("notice--new", html)
        self.assertIn('class="notice__dot"', html)
        self.assertIn(f"--hue: {notice.hue}", html)

    def test_your_own_notice_is_neither(self):
        self._post(self.me)
        html = self._board()

        self.assertIn("notice--mine", html)
        self.assertNotIn("notice--from", html)
        self.assertNotIn('class="notice__dot"', html)

    def test_an_older_notice_keeps_the_colour_but_loses_the_dot(self):
        self._post(self.them, days_ago=3)
        html = self._board()

        self.assertIn("notice--from", html)
        self.assertNotIn("notice--new", html)
        self.assertNotIn('class="notice__dot"', html)

    def test_the_cards_are_staggered_from_the_first_one(self):
        # The first row's index is 0, and a template tag that drops falsy
        # values once left it blank — which is not a number CSS can use.
        for n in range(3):
            self._post(self.them, body=f"Notice {n}")
        html = self._board()

        self.assertIn("--i: 0", html)
        self.assertIn("--i: 1", html)
        self.assertIn("--i: 2", html)


class NotificationLandingTests(TestCase):
    """
    Where a notification puts you.

    A link that lands on the top of the board when it was about something from
    last week is a link that failed, so what is tested here is the arriving
    rather than the sending: the right page, and an anchor that is on it.
    """

    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.client.force_login(self.kiran)

    def test_a_notification_names_the_page_as_well_as_the_anchor(self):
        from apps.noticeboard import notify

        notice = Notice.objects.create(author=self.sam, body="Fridge is fixed.")
        notify.notice_posted(notice)

        from apps.notifications.models import Notification

        url = Notification.objects.filter(recipient=self.kiran).get().url
        self.assertIn(f"notice={notice.pk}", url)
        self.assertIn(f"#notice-{notice.pk}", url)

    def test_the_board_opens_on_the_page_holding_the_notice(self):
        from apps.noticeboard.views import PER_PAGE

        # A page and a half of notices, so the oldest is not on page one.
        made = [
            Notice.objects.create(author=self.sam, body=f"notice {n}")
            for n in range(PER_PAGE + 5)
        ]
        oldest = made[0]

        resp = self.client.get(reverse("notices:board"), {"notice": oldest.pk})

        self.assertEqual(resp.context["page_obj"].number, 2)
        self.assertContains(resp, f'id="notice-{oldest.pk}"')

    def test_paging_by_hand_beats_the_link(self):
        from apps.noticeboard.views import PER_PAGE

        made = [
            Notice.objects.create(author=self.sam, body=f"notice {n}")
            for n in range(PER_PAGE + 5)
        ]

        resp = self.client.get(
            reverse("notices:board"), {"notice": made[0].pk, "page": 1}
        )
        self.assertEqual(resp.context["page_obj"].number, 1)

    def test_a_notice_that_has_since_been_deleted_lands_on_page_one(self):
        Notice.objects.create(author=self.sam, body="still here")

        resp = self.client.get(reverse("notices:board"), {"notice": 9999})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.context["page_obj"].number, 1)

    def test_rubbish_in_the_link_is_not_an_error_page(self):
        Notice.objects.create(author=self.sam, body="still here")

        for junk in ["", "abc", "-1", "1.5"]:
            with self.subTest(notice=junk):
                resp = self.client.get(reverse("notices:board"), {"notice": junk})
                self.assertEqual(resp.status_code, 200)

    def test_the_comment_you_were_told_about_is_rendered_on_that_page(self):
        notice = Notice.objects.create(author=self.kiran, body="Anyone free Friday?")
        comment = Comment.objects.create(
            notice=notice, author=self.sam, body="I can cover it."
        )
        from apps.noticeboard import notify

        notify.comment_posted(comment)

        from apps.notifications.models import Notification

        url = Notification.objects.filter(recipient=self.kiran).get().url
        resp = self.client.get(url.split("#")[0])

        self.assertContains(resp, f'id="comment-{comment.pk}"')
